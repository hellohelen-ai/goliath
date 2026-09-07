import { keyValueMemory } from "@hellohelen-ai/goliath";
import type { ChatMessage, Conversation } from "../types/conversation";

type Parameter = string | number | null;
// The small Expo SQLite surface also lets the repository run against SQLite in tests.
export type StorageDatabase = {
  execAsync: (sql: string) => Promise<void>;
  runAsync: (sql: string, ...params: Parameter[]) => Promise<unknown>;
  getAllAsync: <T>(sql: string, ...params: Parameter[]) => Promise<T[]>;
};
export type ConversationStorage = {
  load: () => Promise<Conversation[]>;
  save: (conversations: Conversation[]) => Promise<void>;
};

export function createSqliteStorage(open: () => Promise<StorageDatabase>) {
  let database: Promise<StorageDatabase> | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  const saved = new Map<string, Conversation>();

  const connect = () => {
    database ??= open()
      .then(async (db) => {
        const [version] = await db.getAllAsync<{ user_version: number }>("PRAGMA user_version");
        if (version.user_version > 1)
          throw new Error("This app needs an update to open your chats.");
        await db.execAsync("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
        await db.execAsync("BEGIN IMMEDIATE");
        try {
          await db.execAsync(`
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, draft TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT NOT NULL, conversation_id TEXT NOT NULL REFERENCES conversations(id),
          position INTEGER NOT NULL, data TEXT NOT NULL,
          PRIMARY KEY (conversation_id, id)
        );
        CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id, position);
        CREATE TABLE IF NOT EXISTS agent_memory (id TEXT PRIMARY KEY, data TEXT NOT NULL);
        PRAGMA user_version = 1;
      `);
          await db.execAsync("COMMIT");
        } catch (error) {
          await db.execAsync("ROLLBACK");
          throw error;
        }
        return db;
      })
      .catch((error) => {
        database = undefined;
        throw error;
      });
    return database;
  };

  // Every consumer of this connection joins the queue, including agent memory writes.
  // A memory save can never accidentally join a conversation's transaction.
  const access = <T>(operation: (db: StorageDatabase) => Promise<T>): Promise<T> => {
    const result = queue.then(async () => operation(await connect()));
    queue = result.catch(() => undefined);
    return result;
  };

  const conversations: ConversationStorage = {
    load: () =>
      access(async (db) => {
        const rows = await db.getAllAsync<{ id: string; created_at: number; draft: string }>(
          "SELECT * FROM conversations ORDER BY created_at DESC, rowid DESC",
        );
        const messages = await db.getAllAsync<{ conversation_id: string; data: string }>(
          "SELECT conversation_id, data FROM messages ORDER BY position",
        );
        const byConversation = new Map<string, ChatMessage[]>();
        for (const row of messages) {
          const list = byConversation.get(row.conversation_id) ?? [];
          list.push(JSON.parse(row.data) as ChatMessage);
          byConversation.set(row.conversation_id, list);
        }
        return rows.map((row) => ({
          id: row.id,
          createdAt: row.created_at,
          draft: row.draft,
          messages: byConversation.get(row.id) ?? [],
        }));
      }),
    save: (chats) =>
      access(async (db) => {
        await db.execAsync("BEGIN IMMEDIATE");
        try {
          for (const chat of chats) {
            await db.runAsync(
              `INSERT INTO conversations (id, created_at, draft) VALUES (?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET draft = excluded.draft`,
              chat.id,
              chat.createdAt,
              chat.draft,
            );
            // Zustand supplies immutable snapshots. Draft edits do not rewrite the transcript.
            const previous = saved.get(chat.id)?.messages ?? [];
            for (const [position, message] of chat.messages.entries()) {
              if (previous[position] === message) continue;
              await db.runAsync(
                `INSERT INTO messages (id, conversation_id, position, data) VALUES (?, ?, ?, ?)
               ON CONFLICT(conversation_id, id) DO UPDATE SET data = excluded.data
               WHERE messages.data != excluded.data`,
                message.id,
                chat.id,
                position,
                JSON.stringify(message),
              );
            }
          }
          await db.execAsync("COMMIT");
          for (const chat of chats) saved.set(chat.id, chat);
        } catch (error) {
          await db.execAsync("ROLLBACK");
          throw error;
        }
      }),
  };

  const memory = (conversationId?: string) =>
    keyValueMemory(
      {
        getItem: (id) =>
          access(async (db) => {
            const [row] = await db.getAllAsync<{ data: string }>(
              "SELECT data FROM agent_memory WHERE id = ?",
              id,
            );
            return row?.data ?? null;
          }),
        setItem: (id, data) =>
          access(async (db) => {
            await db.runAsync(
              `INSERT INTO agent_memory (id, data) VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
              id,
              data,
            );
          }),
      },
      JSON.stringify(conversationId ?? null),
    );

  return { conversations, memory };
}
