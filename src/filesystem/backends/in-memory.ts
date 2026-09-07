import { checkAbort } from "../../context.js";
import { checkContent, filePath, normalizePath, pageLimit, revision, within } from "../paths.js";
import type { FileEntry, FileSeeds, FilesystemBackend } from "../types.js";

export function inMemoryFilesystem(initial: FileSeeds = {}): FilesystemBackend {
  const files = new Map<string, FileEntry>();
  for (const [path, content] of Object.entries(initial)) {
    const key = filePath(path);
    if (files.has(key)) throw new Error(`Duplicate file: ${key}`);
    checkContent(content);
    files.set(key, { path: key, content, revision: revision() });
  }
  return {
    async read(path, signal) {
      checkAbort(signal);
      const entry = files.get(filePath(path));
      if (!entry) throw new Error(`File not found: ${path}`);
      return { ...entry };
    },
    async list(path, options = {}) {
      checkAbort(options.signal);
      const root = normalizePath(path);
      const limit = pageLimit(options.limit);
      const matches = [...files.keys()]
        .filter((key) => within(key, root) && key > (options.after ?? ""))
        .sort();
      const keys = matches.slice(0, limit);
      return {
        files: keys.map((key) => ({ path: key, revision: files.get(key)!.revision })),
        next: matches.length > limit ? keys.at(-1)! : null,
      };
    },
    async write(path, content, options) {
      checkAbort(options.signal);
      const key = filePath(path);
      checkContent(content);
      if ((files.get(key)?.revision ?? null) !== options.expectedRevision)
        throw new Error("File changed; read its current revision before writing.");
      const entry = { path: key, content, revision: revision() };
      files.set(key, entry);
      return { path: key, revision: entry.revision };
    },
    async remove(path, options) {
      checkAbort(options.signal);
      const key = filePath(path);
      if (!files.has(key) || files.get(key)!.revision !== options.expectedRevision)
        throw new Error("File changed or is missing; read it before deleting.");
      files.delete(key);
    },
  };
}
