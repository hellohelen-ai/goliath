import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgent } from "@hellohelen-ai/goliath";
import { fakeModel } from "@hellohelen-ai/goliath/testing";
import { createAppStore } from "../src/stores/app-store";
import {
  createSqliteStorage,
  type StorageDatabase,
  type ConversationStorage,
} from "../src/storage/sqlite-storage";
import { createConversationPersistence } from "../src/storage/conversation-persistence";
import type { Conversation } from "../src/types/conversation";

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0).reverse()) dispose();
});

function sqlite(path = ":memory:") {
  const db = new Database(path);
  const connection: StorageDatabase = {
    execAsync: async (sql) => {
      db.exec(sql);
    },
    runAsync: async (sql, ...params) => db.query(sql).run(...params),
    getAllAsync: async <T>(sql: string, ...params: (string | number | null)[]) =>
      db.query(sql).all(...params) as T[],
  };
  let closed = false;
  const close = () => {
    if (!closed) {
      db.close();
      closed = true;
    }
  };
  cleanup.push(close);
  return { db, connection, storage: createSqliteStorage(async () => connection), close };
}

const conversation = (id = "a"): Conversation => ({
  id,
  createdAt: 1,
  draft: "An unsent draft",
  messages: [],
});
const deferred = <T>() => Promise.withResolvers<T>();
const silenceErrors = () => {
  const spy = spyOn(console, "error").mockImplementation(() => {});
  cleanup.push(() => spy.mockRestore());
};

describe("durable conversations", () => {
  test("reopens a real database with full chats, drafts, tool results and isolated agent context", async () => {
    const folder = mkdtempSync(join(tmpdir(), "goliath-persistence-"));
    cleanup.push(() => rmSync(folder, { recursive: true, force: true }));
    const path = join(folder, "goliath.db");
    const first = sqlite(path);
    const app = createAppStore();
    const persistence = createConversationPersistence(app, first.storage.conversations);
    await persistence.initialize();
    const actions = app.getState();
    const address = { conversationId: "first", messageId: "reply" };
    actions.startTurn(address, "My codename is Cedar.");
    const agent = createAgent({
      model: fakeModel([{ text: "Remembered Cedar." }]),
      memory: first.storage.memory,
    });
    const result = await agent.run("My codename is Cedar.", { conversationId: "first" });
    actions.completeTurn(address, result);
    actions.requestApproval(address, { tool: "createTask", input: { title: "Read" } });
    actions.recordApproval(address, true);
    actions.setDraft("first", "What is my codename?");
    const second = actions.newConversation();
    actions.setDraft(second, "Another draft");
    await persistence.flush();
    const before = app.getState().conversations;
    first.close();

    const reopened = sqlite(path);
    const freshApp = createAppStore();
    const restored = createConversationPersistence(freshApp, reopened.storage.conversations);
    await restored.initialize();
    expect(freshApp.getState().conversations).toEqual(before);
    expect(freshApp.getState().selectedId).toBeNull();
    const model = fakeModel([{ text: "Cedar." }, { text: "No name yet." }]);
    const newAgent = createAgent({ model, memory: reopened.storage.memory });
    await newAgent.run("What is my codename?", { conversationId: "first" });
    await newAgent.run("What is my codename?", { conversationId: second });
    expect(JSON.stringify(model.calls[0]!.prompt)).toContain("Cedar");
    expect(JSON.stringify(model.calls[1]!.prompt)).not.toContain("Cedar");
    expect(
      (await reopened.storage.conversations.load()).find(({ id }) => id === "first")!.messages,
    ).toHaveLength(2);
  });

  test("restores pending runs as interrupted, expires approvals and allows an explicit new send", async () => {
    const { storage } = sqlite();
    const pending = conversation();
    pending.messages = [
      { id: "ask", role: "user", text: "Add a task" },
      {
        id: "pending",
        role: "assistant",
        text: "",
        status: "running",
        confirmation: { tool: "createTask", input: { title: "Read" } },
      },
      {
        id: "approved",
        role: "assistant",
        text: "",
        status: "running",
        confirmation: { tool: "createTask", input: {}, decision: true },
      },
    ];
    await storage.conversations.save([pending]);
    const app = createAppStore();
    const persistence = createConversationPersistence(app, storage.conversations);
    await persistence.initialize();
    const chat = app.getState().conversations[0];
    expect(chat.messages[1]).toMatchObject({
      status: "interrupted",
      confirmation: { decision: false },
    });
    expect(chat.messages[2]).toMatchObject({
      status: "interrupted",
      confirmation: { decision: true },
    });
    expect(chat.messages[1].text).toContain("Some steps may already have finished");
    expect((await storage.conversations.load())[0]).toEqual(chat);
    expect(
      app.getState().startTurn({ conversationId: "a", messageId: "retry" }, "List tasks first"),
    ).toBe(true);
    await persistence.flush();
  });

  test("keeps the full transcript when the model memory is compacted", async () => {
    const { storage } = sqlite();
    const chat = conversation();
    chat.messages = Array.from({ length: 50 }, (_, index) => ({
      id: `message-${index}`,
      role: "user",
      text: `Original message ${index}`,
    }));
    await storage.conversations.save([chat]);
    await storage.memory("a").save({ summary: "A compressed history", recent: [] });
    expect((await storage.conversations.load())[0].messages).toEqual(chat.messages);
    expect(await storage.memory("a").load()).toEqual({
      summary: "A compressed history",
      recent: [],
    });
    expect(await storage.memory().load()).toEqual({ summary: "", recent: [] });
    expect(await storage.memory("null").load()).toEqual({ summary: "", recent: [] });
  });

  test("hydrates once before saving and coalesces edits made during a pending write", async () => {
    const loaded = deferred<Conversation[]>();
    const writeStarted = deferred<void>();
    const finishWrite = deferred<void>();
    let loads = 0;
    const saved: Conversation[][] = [];
    const storage: ConversationStorage = {
      load: () => {
        loads++;
        return loaded.promise;
      },
      save: async (chats) => {
        saved.push(chats);
        if (saved.length === 2) {
          writeStarted.resolve();
          await finishWrite.promise;
        }
      },
    };
    const app = createAppStore();
    const persistence = createConversationPersistence(app, storage);
    const first = persistence.initialize();
    const second = persistence.initialize();
    expect(loads).toBe(1);
    expect(saved).toEqual([]);
    expect(persistence.state.getState().hydrated).toBe(false);
    await expect(persistence.flush()).rejects.toThrow("still loading");
    loaded.resolve([conversation()]);
    await Promise.all([first, second]);
    app.getState().setDraft("a", "First edit");
    await writeStarted.promise;
    app.getState().setDraft("a", "Newest edit");
    app.getState().setQuery("Temporary search");
    finishWrite.resolve();
    await persistence.flush();
    expect(saved.at(-1)![0].draft).toBe("Newest edit");
    expect(saved).toHaveLength(3);
  });

  test("retains unsaved edits after a write failure and retries without reloading stale data", async () => {
    silenceErrors();
    const { storage } = sqlite();
    let failing = false;
    const app = createAppStore();
    const persistence = createConversationPersistence(app, {
      load: storage.conversations.load,
      save: async (chats) => {
        if (failing) throw new Error("Disk full");
        await storage.conversations.save(chats);
      },
    });
    await persistence.initialize();
    failing = true;
    app.getState().setDraft("first", "Keep this");
    await expect(persistence.flush()).rejects.toThrow("could not be saved");
    expect(persistence.state.getState().error).not.toBeNull();
    app.getState().setDraft("first", "Keep the latest edit");
    failing = false;
    await persistence.retry();
    expect(persistence.state.getState().error).toBeNull();
    expect((await storage.conversations.load())[0].draft).toBe("Keep the latest edit");
  });

  test("a failed load never overwrites existing data with the initial blank conversation", async () => {
    silenceErrors();
    let saves = 0;
    let failing = true;
    const app = createAppStore();
    const persistence = createConversationPersistence(app, {
      load: async () => {
        if (failing) throw new Error("Unavailable");
        return [conversation("saved")];
      },
      save: async () => {
        saves++;
      },
    });
    await persistence.initialize();
    expect(saves).toBe(0);
    expect(persistence.state.getState().hydrated).toBe(false);
    failing = false;
    await persistence.retry();
    expect(app.getState().conversations[0].id).toBe("saved");
    expect(saves).toBe(1);
  });

  test("rolls back a partial transaction and serializes memory writes outside it", async () => {
    const { storage } = sqlite();
    await storage.conversations.save([conversation()]);
    const invalid = { ...conversation(), draft: "Must roll back" };
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    invalid.messages = [
      { id: "bad", role: "assistant", text: "", confirmation: { tool: "save", input: cyclic } },
    ];
    const [failed, memory] = await Promise.allSettled([
      storage.conversations.save([invalid]),
      storage.memory("a").save({ summary: "Durable memory", recent: [] }),
    ]);
    expect(failed.status).toBe("rejected");
    expect(memory.status).toBe("fulfilled");
    expect((await storage.conversations.load())[0].draft).toBe("An unsent draft");
    expect((await storage.memory("a").load()).summary).toBe("Durable memory");
  });

  test("refuses a future database version without rewriting it", async () => {
    const { db, storage } = sqlite();
    db.exec("PRAGMA user_version = 2");
    await expect(storage.conversations.load()).rejects.toThrow("needs an update");
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 2 });
  });

  test("message IDs in different conversations cannot overwrite each other", async () => {
    const { storage } = sqlite();
    const a = conversation("a");
    const b = conversation("b");
    a.messages = [{ id: "same", role: "user", text: "Cedar" }];
    b.messages = [{ id: "same", role: "user", text: "Birch" }];
    await storage.conversations.save([a, b]);
    const chats = await storage.conversations.load();
    expect(chats.find(({ id }) => id === "a")!.messages[0].text).toBe("Cedar");
    expect(chats.find(({ id }) => id === "b")!.messages[0].text).toBe("Birch");
  });

  test("a failed agent memory save still preserves the reply and reports the memory error", async () => {
    const { storage } = sqlite();
    const memory = storage.memory("first");
    const agent = createAgent({
      model: fakeModel([{ text: "Remembered Cedar." }]),
      memory: () => ({
        ...memory,
        save: async () => {
          throw new Error("Disk full");
        },
      }),
    });
    const app = createAppStore();
    const persistence = createConversationPersistence(app, storage.conversations);
    await persistence.initialize();
    const address = { conversationId: "first", messageId: "reply" };
    app.getState().startTurn(address, "Remember Cedar");
    const result = await agent.run("Remember Cedar", { conversationId: "first" });
    app.getState().completeTurn(address, result);
    await persistence.flush();
    expect(result.trace.some((event) => event.type === "memory-error")).toBe(true);
    expect((await storage.conversations.load())[0].messages[1].text).toBe("Remembered Cedar.");
    expect((await memory.load()).recent).toEqual([]);
  });
});
