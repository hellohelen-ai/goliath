import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createAgent } from "@hellohelen-ai/goliath";
import { createFilesystem, type FilesystemDatabase } from "@hellohelen-ai/goliath/filesystem";
import { fakeModel } from "@hellohelen-ai/goliath/testing";
import { createFileBackend } from "../src/agents/goliath/filesystem/backend";
import { createAgentRuntime } from "../src/agents/goliath/runtime";

function database() {
  const db = new Database(":memory:");
  const adapter: FilesystemDatabase = {
    execAsync: async (sql) => {
      db.exec(sql);
    },
    runAsync: async (sql, ...params) => db.query(sql).run(...params),
    getAllAsync: async <T>(sql: string, ...params: (string | number | null)[]) =>
      db.query(sql).all(...params) as T[],
  };
  return { db, adapter };
}
test("example shares durable notes, isolates scratch, and keeps shipped docs read-only", async () => {
  const { db, adapter } = database();
  try {
    const backend = createFileBackend(async () => adapter);
    const a = backend({ conversationId: "a" });
    const b = backend({ conversationId: "b" });
    await a.write!("/notes/test.md", "persistent note", { expectedRevision: null });
    await a.write!("/scratch.md", "temporary", { expectedRevision: null });
    expect((await b.read("/notes/test.md")).content).toBe("persistent note");
    await expect(b.read("/scratch.md")).rejects.toThrow();
    await expect(a.write!("/docs/guide.md", "changed", { expectedRevision: null })).rejects.toThrow(
      "Read-only",
    );
    const restarted = createFileBackend(async () => adapter)({ conversationId: "a" });
    expect((await restarted.read("/notes/test.md")).content).toBe("persistent note");
    await expect(restarted.read("/scratch.md")).rejects.toThrow();
    const tool = createFilesystem({ backend: restarted }).tools.grep!;
    const result = await tool.execute({ path: "/docs", pattern: "BLUEBELL" }, {});
    expect(result.matches[0].path).toBe("/docs/garden.md");
  } finally {
    db.close();
  }
});
test("runtime file approval saves exactly the displayed input", async () => {
  const { db, adapter } = database();
  try {
    const backend = createFileBackend(async () => adapter);
    const files = createFilesystem({ backend, readOnly: false });
    const model = fakeModel([
      { json: { kind: "tool", tool: "writeFile", brief: "Save the garden note" } },
      { json: { path: "/notes/garden.md", content: "Water basil Tuesday." } },
      { json: { kind: "answer", brief: "Report the save" } },
      { text: "Saved your note." },
    ]);
    const runtime = createAgentRuntime(createAgent({ model, tools: files.tools }));
    let shown: unknown;
    const done = runtime.ask("a", "Save a garden note", {
      onApproval: (request) => {
        shown = request.input;
        expect(request.tool).toBe("writeFile");
        runtime.approve("a", true);
      },
    });
    expect((await done).text).toBe("Saved your note.");
    expect(shown).toEqual({ path: "/notes/garden.md", content: "Water basil Tuesday." });
    expect((await backend({ conversationId: "a" }).read("/notes/garden.md")).content).toBe(
      "Water basil Tuesday.",
    );
    runtime.dispose();
  } finally {
    db.close();
  }
});
