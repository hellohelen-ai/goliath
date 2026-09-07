import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compositeFilesystem,
  createFilesystem,
  inMemoryFilesystem,
  sqliteFilesystem,
  staticFilesystem,
  type FilesystemBackend,
  type FilesystemDatabase,
  type ReadResult,
  type SearchResult,
} from "../src/filesystem/index.js";
import { estimateTokens } from "../src/budget.js";
import { createAgent, type ToolContext } from "../src/index.js";
import { fakeModel } from "../src/testing/index.js";
import { retrievedSteps } from "../src/tool-output.js";

const directory = mkdtempSync(join(tmpdir(), "goliath-files-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const open = (filename = ":memory:") => {
  const db = new Database(filename);
  const adapter: FilesystemDatabase = {
    execAsync: async (sql) => {
      db.exec(sql);
    },
    runAsync: async (sql, ...params) => db.query(sql).run(...params),
    getAllAsync: async <T>(sql: string, ...params: (string | number | null)[]) =>
      db.query(sql).all(...params) as T[],
  };
  return { db, adapter };
};
const call = async (
  backend: FilesystemBackend,
  name: string,
  input: unknown,
  context: ToolContext = {},
  extra = {},
) => {
  const tool = createFilesystem({ backend, ...extra }).tools[name]!;
  return tool.execute(tool.parameters.parse(input), context);
};
async function allPaths(backend: FilesystemBackend) {
  const paths: string[] = [];
  let after: string | undefined;
  do {
    const page = await backend.list("/", { limit: 2, ...(after ? { after } : {}) });
    paths.push(...page.files.map((entry) => entry.path));
    after = page.next ?? undefined;
  } while (after);
  return paths;
}

describe("filesystem backends", () => {
  for (const [name, make] of [
    ["memory", () => inMemoryFilesystem()],
    ["sqlite", () => sqliteFilesystem(open().adapter)],
  ] as const) {
    test(`${name}: revisions, recursive ordering, directory boundaries, cancellation`, async () => {
      const store = make();
      const a = await store.write!("/notes/a", "first", { expectedRevision: null });
      await expect(
        store.write!("/notes/a", "lost update", { expectedRevision: null }),
      ).rejects.toThrow("changed");
      const b = await store.write!("/notes/a", "second", { expectedRevision: a.revision });
      await expect(store.remove!("/notes/a", { expectedRevision: a.revision })).rejects.toThrow();
      expect((await store.read("/notes/a")).content).toBe("second");
      await store.write!("/notes2/b", "outside", { expectedRevision: null });
      expect((await store.list("/notes")).files.map((file) => file.path)).toEqual(["/notes/a"]);
      await store.remove!("/notes/a", { expectedRevision: b.revision });
      await expect(store.read("/notes/a")).rejects.toThrow("not found");
      for (const path of ["/z", "/😀", "/\uE000", "/a/child"])
        await store.write!(path, path, { expectedRevision: null });
      expect(await allPaths(store)).toEqual(
        ["/notes2/b", "/z", "/😀", "/\uE000", "/a/child"].sort(),
      );
      await expect(store.read("/z", AbortSignal.abort())).rejects.toThrow();
      await expect(store.write!("/../escape", "", { expectedRevision: null })).rejects.toThrow();
      await expect(
        store.write!("/big", "x".repeat(1048577), { expectedRevision: null }),
      ).rejects.toThrow();
    });
  }
  test("SQLite survives reopening, isolates namespaces, and atomically rejects concurrent stale edits", async () => {
    const filename = join(directory, "persist.db");
    const first = open(filename);
    const store = sqliteFilesystem(first.adapter, { namespace: "one" });
    const original = await store.write!("/note", "saved", { expectedRevision: null });
    first.db.close();
    const second = open(filename);
    const third = open(filename);
    const a = sqliteFilesystem(second.adapter, { namespace: "one" });
    const b = sqliteFilesystem(third.adapter, { namespace: "one" });
    expect((await a.read("/note")).content).toBe("saved");
    expect((await sqliteFilesystem(second.adapter, { namespace: "two" }).list("/")).files).toEqual(
      [],
    );
    const results = await Promise.allSettled([
      a.write!("/note", "a", { expectedRevision: original.revision }),
      b.write!("/note", "b", { expectedRevision: original.revision }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    second.db.close();
    third.db.close();
  });
  test("static content is a read-only snapshot", async () => {
    const seeds = { "/a": "original" };
    const store = staticFilesystem(seeds);
    seeds["/a"] = "changed";
    expect((await store.read("/a")).content).toBe("original");
    expect(store.write).toBeUndefined();
  });
  test("composite mounts shadow hidden files, route on directory boundaries, and paginate globally", async () => {
    const backend = compositeFilesystem({
      default: inMemoryFilesystem({
        "/docs/hidden": "hidden",
        "/docs/deep/hidden": "",
        "/docs2/a": "root",
        "/z": "",
      }),
      routes: {
        "/docs/": staticFilesystem({ "/a": "docs", "/deep/hidden": "", "/z": "" }),
        "/docs/deep": { backend: inMemoryFilesystem({ "/b": "nested" }), readOnly: true },
      },
    });
    expect(await allPaths(backend)).toEqual([
      "/docs/a",
      "/docs/deep/b",
      "/docs/z",
      "/docs2/a",
      "/z",
    ]);
    expect((await backend.read("/docs/deep/b")).content).toBe("nested");
    expect((await backend.read("/docs2/a")).content).toBe("root");
    await expect(backend.read("/docs/hidden")).rejects.toThrow();
    await expect(backend.write!("/docs/deep/new", "", { expectedRevision: null })).rejects.toThrow(
      "Read-only",
    );
  });
});

describe("filesystem tools", () => {
  test("default tools are read-only and traversal is rejected", async () => {
    const files = createFilesystem();
    expect(Object.keys(files.tools)).toEqual(["glob", "grep", "readFile"]);
    expect(() => createFilesystem({ tools: ["writeFile"] })).toThrow("readOnly");
    const store = inMemoryFilesystem({ "/secret": "secret" });
    await expect(
      call(store, "readFile", { path: "/allowed/../secret" }, {}, { root: "/allowed" }),
    ).rejects.toThrow();
    await expect(
      call(store, "readFile", { path: "/secret" }, {}, { root: "/allowed" }),
    ).rejects.toThrow();
  });
  test("long Unicode lines paginate without losing characters, with bounded native-tokenizer output", async () => {
    const content = "😀漢字 ".repeat(200) + "\nlast line\n";
    const store = inMemoryFilesystem({ "/unicode": content });
    let cursor: string | null = null;
    let combined = "";
    let pages = 0;
    const countTokens = (text: string) => Array.from(text).length;
    do {
      const result: ReadResult = await call(
        store,
        "readFile",
        { path: "/unicode", ...(cursor ? { cursor } : {}) },
        { resultBudget: { maxTokens: 500, countTokens } },
      );
      const formatter = createFilesystem().tools.readFile!.toModelOutput!;
      expect(countTokens(formatter(result))).toBeLessThanOrEqual(500);
      expect(result.content).not.toMatch(
        /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/,
      );
      combined += result.content;
      cursor = result.nextCursor;
      expect(++pages).toBeLessThan(100);
    } while (cursor);
    expect(pages).toBeGreaterThan(1);
    expect(combined).toBe(content);
  });
  test("line offsets, EOF, and revision-bound read cursors", async () => {
    const store = inMemoryFilesystem({ "/a": "one\ntwo\nthree" });
    const first: ReadResult = await call(store, "readFile", { path: "/a", offset: 1, limit: 1 });
    expect(first.content).toBe("two\n");
    expect(first.line).toBe(2);
    expect((await call(store, "readFile", { path: "/a", cursor: first.nextCursor })).content).toBe(
      "three",
    );
    expect((await call(store, "readFile", { path: "/a", offset: 999 })).nextCursor).toBeNull();
    await store.write!("/a", "changed", { expectedRevision: first.revision });
    await expect(call(store, "readFile", { path: "/a", cursor: first.nextCursor })).rejects.toThrow(
      "changed",
    );
  });
  test("glob and literal grep paginate all results including empty scan pages", async () => {
    const store = inMemoryFilesystem({
      "/a.txt": "no",
      "/b.md": "no",
      "/docs/a.md": "A.*\na.*",
      "/docs/b.md": "a.*",
    });
    const glob: SearchResult = await call(store, "glob", { pattern: "/**/*.md" });
    expect(glob.matches.map((match) => match.path)).toEqual(["/b.md", "/docs/a.md", "/docs/b.md"]);
    const matches = [];
    let cursor: string | null = null;
    let emptyPages = 0;
    do {
      const page: SearchResult = await call(
        store,
        "grep",
        { pattern: "a.*", ...(cursor ? { cursor } : {}) },
        {},
        { search: { maxMatches: 1, maxFiles: 1 } },
      );
      if (!page.matches.length) emptyPages++;
      matches.push(...page.matches);
      cursor = page.nextCursor;
    } while (cursor);
    expect(emptyPages).toBeGreaterThan(0);
    expect(matches.map((match) => [match.path, match.line])).toEqual([
      ["/docs/a.md", 1],
      ["/docs/a.md", 2],
      ["/docs/b.md", 1],
    ]);
    expect((await call(store, "grep", { pattern: "A.*", ignoreCase: false })).matches).toHaveLength(
      1,
    );
  });
  test("search cursors cannot escape the root or resume a changed file", async () => {
    const store = inMemoryFilesystem({ "/safe/a": "hit\nhit", "/secret": "hit" });
    const first: SearchResult = await call(
      store,
      "grep",
      { pattern: "hit" },
      {},
      { root: "/safe", search: { maxMatches: 1 } },
    );
    const tampered = JSON.parse(first.nextCursor!);
    tampered.after = "/secret";
    await expect(
      call(
        store,
        "grep",
        { pattern: "hit", cursor: JSON.stringify(tampered) },
        {},
        { root: "/safe" },
      ),
    ).rejects.toThrow("root");
    const entry = await store.read("/safe/a");
    await store.write!("/safe/a", "hit changed", { expectedRevision: entry.revision });
    await expect(
      call(store, "grep", { pattern: "hit", cursor: first.nextCursor }, {}, { root: "/safe" }),
    ).rejects.toThrow("changed");
  });
  test("edits require a unique match and current revision; deletes remove exactly one file", async () => {
    const store = inMemoryFilesystem({ "/a": "same same", "/b": "keep" });
    const entry = await store.read("/a");
    const options = { readOnly: false };
    await expect(
      call(
        store,
        "editFile",
        { path: "/a", revision: entry.revision, oldText: "same", newText: "new" },
        {},
        options,
      ),
    ).rejects.toThrow("exactly once");
    const edited = await call(
      store,
      "editFile",
      { path: "/a", revision: entry.revision, oldText: "same same", newText: "new" },
      {},
      options,
    );
    expect((await store.read("/a")).content).toBe("new");
    await call(store, "deleteFile", { path: "/a", revision: edited.revision }, {}, options);
    expect(await allPaths(store)).toEqual(["/b"]);
  });
  test("backend factories receive the conversation without sharing scratch files", async () => {
    const stores = new Map([
      ["a", inMemoryFilesystem({ "/note": "a" })],
      ["b", inMemoryFilesystem({ "/note": "b" })],
    ]);
    const files = createFilesystem({
      backend: ({ conversationId }) => stores.get(conversationId!)!,
    });
    expect(
      (await files.tools.readFile!.execute({ path: "/note" }, { conversationId: "b" })).content,
    ).toBe("b");
  });
});

describe("harness retrieval integration", () => {
  test("file content beyond 600 characters reaches the answer model within the default window", async () => {
    const content = "A short garden observation. ".repeat(30) + "Code: BLUEBELL.";
    const model = fakeModel([
      { json: { kind: "tool", tool: "readFile", brief: "Read /guide" } },
      { json: { path: "/guide" } },
      { json: { kind: "answer", brief: "Give the code." } },
      { text: "BLUEBELL" },
    ]);
    const files = createFilesystem({ backend: staticFilesystem({ "/guide": content }) });
    const result = await createAgent({ model, tools: files.tools }).run(
      "What is the code in /guide?",
    );
    expect(result.text).toBe("BLUEBELL");
    expect(result.steps[0]!.result!.length).toBeGreaterThan(600);
    expect(JSON.stringify(model.calls.at(-1)!.prompt)).toContain("Code: BLUEBELL");
    expect(estimateTokens(result.steps[0]!.result!)).toBeLessThanOrEqual(512);
    expect(model.remaining()).toBe(0);
    expect(
      result.trace
        .filter((event) => event.type === "budget")
        .every((event) => event.tokens <= event.limit),
    ).toBe(true);
  });
  test("write tools decline without an explicit approval handler, and run-level approval enables them", async () => {
    for (const approve of [false, true]) {
      const backend = inMemoryFilesystem();
      const model = fakeModel([
        { json: { kind: "tool", tool: "writeFile", brief: "Save /a" } },
        { json: { path: "/a", content: "saved" } },
        { json: { kind: "answer", brief: "Report outcome" } },
        { text: "done" },
      ]);
      const agent = createAgent({
        model,
        tools: createFilesystem({ backend, readOnly: false }).tools,
      });
      await agent.run("Save /a", approve ? { confirm: async () => true } : {});
      expect((await backend.list("/")).files).toHaveLength(approve ? 1 : 0);
    }
  });
  test("older excerpts leave model context without mutating the application transcript", async () => {
    const steps = [0, 1, 2].map((index) => ({
      index,
      kind: "tool" as const,
      brief: "",
      outputMode: "content" as const,
      result: `file${index}: ` + "x".repeat(200),
    }));
    const projected = await retrievedSteps(steps, { maxTokens: 120 });
    expect(projected[0]!.result).toContain("omitted");
    expect(projected[2]!.result).toBe(steps[2]!.result);
    expect(steps[0]!.result).toContain("file0");
  });
});

test("glob → grep → line read → answer works as one budgeted agent turn", async () => {
  const backend = staticFilesystem({
    "/garden.md": "No code here.\n".repeat(80) + "Code: BLUEBELL.",
  });
  const model = fakeModel([
    { json: { kind: "tool", tool: "glob", brief: "Find markdown files" } },
    { json: { pattern: "/**/*.md" } },
    { json: { kind: "tool", tool: "grep", brief: "Find Code in /garden.md" } },
    { json: { pattern: "Code:", path: "/garden.md" } },
    { json: { kind: "tool", tool: "readFile", brief: "Read line 81 of /garden.md" } },
    { json: { path: "/garden.md", offset: 80, limit: 1 } },
    { json: { kind: "answer", brief: "Give the code" } },
    { text: "BLUEBELL" },
  ]);
  const result = await createAgent({
    model,
    tools: createFilesystem({ backend }).tools,
    countTokens: estimateTokens,
  }).run("What is the garden code?");
  expect(result.text).toBe("BLUEBELL");
  expect(result.steps.filter((step) => step.kind === "tool").map((step) => step.tool)).toEqual([
    "glob",
    "grep",
    "readFile",
  ]);
  expect(model.remaining()).toBe(0);
  expect(JSON.stringify(model.calls.at(-1)!.prompt)).toContain("Code: BLUEBELL");
});

test("grep shrinks dense Unicode excerpts to fit its default allowance", async () => {
  const backend = staticFilesystem({ "/a": "🌿".repeat(200) });
  const tool = createFilesystem({ backend }).tools.grep!;
  const result = await tool.execute({ pattern: "🌿" }, {});
  expect(result.matches).toHaveLength(1);
  expect(result.matches[0].excerpt).not.toBe("");
  expect(estimateTokens(tool.toModelOutput!(result))).toBeLessThanOrEqual(512);
});

test("an afterTool hook cannot exceed a content tool's configured result budget", async () => {
  const model = fakeModel([
    { json: { kind: "tool", tool: "readFile", brief: "Read /a" } },
    { json: { path: "/a" } },
    { json: { kind: "answer", brief: "Report" } },
    { text: "done" },
  ]);
  const result = await createAgent({
    model,
    tools: createFilesystem({ backend: staticFilesystem({ "/a": "hello" }) }).tools,
    budgets: { toolResultTokens: 200, retrievedContextTokens: 400 },
    extensions: [{ name: "large-result", afterTool: () => ({ result: "x".repeat(10000) }) }],
  }).run("Read /a");
  expect(estimateTokens(result.steps[0]!.result!)).toBeLessThanOrEqual(200);
  expect(result.steps[0]!.result).toContain("truncated");
  expect((result.steps[0]!.output as ReadResult).content).toBe("hello");
});

test("read continuation rejects another query and impossible Unicode positions", async () => {
  const backend = inMemoryFilesystem({ "/a": "😀\nsecond", "/b": "b" });
  const first: ReadResult = await call(backend, "readFile", { path: "/a", limit: 1 });
  await expect(call(backend, "readFile", { path: "/b", cursor: first.nextCursor })).rejects.toThrow(
    "query",
  );
  const forged = JSON.parse(first.nextCursor!);
  forged.position = 1;
  await expect(
    call(backend, "readFile", { path: "/a", cursor: JSON.stringify(forged) }),
  ).rejects.toThrow("position");
});
