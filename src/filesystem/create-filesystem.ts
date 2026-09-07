import { z } from "zod";
import { defineTool } from "../tools/define-tool.js";
import type { ToolContext, ToolMap } from "../types.js";
import { filePath, normalizePath, within } from "./paths.js";
import { readPage, formatRead } from "./read.js";
import { search, formatSearch } from "./search.js";
import { inMemoryFilesystem } from "./backends/in-memory.js";
import type { FilesystemSource } from "./types.js";

export type FilesystemOptions = {
  backend?: FilesystemSource;
  root?: string;
  readOnly?: boolean;
  tools?: readonly FilesystemToolName[];
  read?: { defaultLines?: number; maxLines?: number };
  search?: { maxMatches?: number; maxFiles?: number };
};
export type FilesystemToolName =
  "glob" | "grep" | "readFile" | "writeFile" | "editFile" | "deleteFile";

export function createFilesystem(options: FilesystemOptions = {}): { tools: ToolMap } {
  const source = options.backend ?? inMemoryFilesystem();
  const root = normalizePath(options.root ?? "/");
  const maxLines = positive(options.read?.maxLines ?? 200, 1000);
  const defaultLines = positive(options.read?.defaultLines ?? Math.min(25, maxLines), maxLines);
  const maxMatches = positive(options.search?.maxMatches ?? 10, 100);
  const maxFiles = positive(options.search?.maxFiles ?? 128, 1024);
  const backend = async (context: ToolContext) =>
    typeof source === "function" ? source(context) : source;
  const path = (value: string, file = true) => {
    const key = file ? filePath(value) : normalizePath(value);
    if (!within(key, root)) throw new Error("Path is outside the configured filesystem root.");
    return key;
  };
  const budget = (context: ToolContext) => context.resultBudget ?? { maxTokens: 512 };
  const signal = (context: ToolContext) => (context.signal ? { signal: context.signal } : {});
  const cursor = z
    .string()
    .max(4096)
    .optional()
    .describe("Copy nextCursor from the previous result to continue. Omit on the first call.");
  const readFile = defineTool({
    name: "readFile",
    description: "Read a file excerpt; use nextCursor to continue and revision to edit.",
    outputMode: "content",
    parameters: z.object({
      path: z.string(),
      offset: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Zero-based starting line. Omit to start at the beginning."),
      limit: z.number().int().min(1).max(maxLines).optional(),
      cursor,
    }),
    execute: async (input, context) =>
      readPage(
        await (await backend(context)).read(path(input.path), context.signal),
        { ...input, limit: input.limit ?? defaultLines },
        budget(context),
      ),
    toModelOutput: formatRead,
  });
  const glob = defineTool({
    name: "glob",
    description:
      "Find file paths using absolute patterns: * matches a name, ** matches directories.",
    outputMode: "content",
    parameters: z.object({ pattern: z.string().max(512), cursor }),
    execute: async (input, context) =>
      search(
        await backend(context),
        {
          kind: "glob",
          root,
          pattern: input.pattern,
          cursor: input.cursor,
          ignoreCase: false,
          maxMatches,
          maxFiles,
          signal: context.signal,
        },
        budget(context),
      ),
    toModelOutput: formatSearch,
  });
  const grep = defineTool({
    name: "grep",
    description: "Find literal text in files; returns matching lines and a continuation cursor.",
    outputMode: "content",
    parameters: z.object({
      pattern: z
        .string()
        .min(1)
        .max(256)
        .describe("Literal text to find, such as greenhouse. Not a file path or regex."),
      path: z
        .string()
        .optional()
        .describe("File or directory to search, such as /docs. Omit to search all files."),
      ignoreCase: z.boolean().optional(),
      cursor,
    }),
    execute: async (input, context) =>
      search(
        await backend(context),
        {
          kind: "grep",
          root: path(input.path ?? root, false),
          pattern: input.pattern,
          cursor: input.cursor,
          ignoreCase: input.ignoreCase ?? true,
          maxMatches,
          maxFiles,
          signal: context.signal,
        },
        budget(context),
      ),
    toModelOutput: formatSearch,
  });
  const writeFile = defineTool({
    name: "writeFile",
    description: "Create a file; to replace one supply its current revision from readFile.",
    writes: true,
    requiresConfirmation: true,
    parameters: z.object({
      path: z.string(),
      content: z.string(),
      revision: z.string().optional(),
    }),
    execute: async (input, context) => {
      const store = await backend(context);
      if (!store.write) throw new Error("Read-only filesystem.");
      return store.write(path(input.path), input.content, {
        expectedRevision: input.revision ?? null,
        ...signal(context),
      });
    },
  });
  const editFile = defineTool({
    name: "editFile",
    description: "Replace one exact text occurrence in a file using its current revision.",
    writes: true,
    requiresConfirmation: true,
    parameters: z.object({
      path: z.string(),
      revision: z.string().min(1),
      oldText: z.string().min(1),
      newText: z.string(),
    }),
    execute: async (input, context) => {
      const store = await backend(context);
      if (!store.write) throw new Error("Read-only filesystem.");
      const entry = await store.read(path(input.path), context.signal);
      if (entry.revision !== input.revision)
        throw new Error("File changed; read its current revision.");
      const index = entry.content.indexOf(input.oldText);
      if (index < 0 || entry.content.indexOf(input.oldText, index + 1) >= 0)
        throw new Error("oldText must match exactly once.");
      return store.write(
        entry.path,
        entry.content.slice(0, index) +
          input.newText +
          entry.content.slice(index + input.oldText.length),
        { expectedRevision: input.revision, ...signal(context) },
      );
    },
  });
  const deleteFile = defineTool({
    name: "deleteFile",
    description: "Delete one file using its current revision; does not delete directories.",
    writes: true,
    requiresConfirmation: true,
    parameters: z.object({ path: z.string(), revision: z.string().min(1) }),
    execute: async (input, context) => {
      const store = await backend(context);
      if (!store.remove) throw new Error("Read-only filesystem.");
      const key = path(input.path);
      await store.remove(key, { expectedRevision: input.revision, ...signal(context) });
      return { path: key, deleted: true };
    },
  });
  const all = { glob, grep, readFile, writeFile, editFile, deleteFile };
  const selected =
    options.tools ??
    (options.readOnly === false
      ? (Object.keys(all) as FilesystemToolName[])
      : (["glob", "grep", "readFile"] as const));
  for (const name of selected) {
    if (!Object.hasOwn(all, name)) throw new Error(`Unknown filesystem tool: ${name}`);
    if (all[name].writes && options.readOnly !== false)
      throw new Error("Enable readOnly: false to register write tools.");
  }
  return { tools: Object.fromEntries(selected.map((name) => [name, all[name]])) };
}
function positive(value: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > max)
    throw new Error(`Expected an integer between 1 and ${max}.`);
  return value;
}
