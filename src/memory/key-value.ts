import type { Memory, MemoryState } from "../types.js";
import { emptyMemory } from "./in-memory.js";

/**
 * The two calls every phone key-value store has. `@react-native-async-storage/async-storage`
 * matches it as is; MMKV and expo-sqlite fit with a two-line wrapper.
 */
type KeyValueStore = {
  getItem: (key: string) => Promise<string | null> | string | null;
  setItem: (key: string, value: string) => Promise<void> | void;
};

/** Memory persisted as one JSON string under `key`. Corrupt data reads as empty. */
const keyValueMemory = (store: KeyValueStore, key = "goliath.memory"): Memory => ({
  load: async () => {
    const raw = await store.getItem(key);
    if (!raw) return emptyMemory();
    try {
      const parsed: unknown = JSON.parse(raw);
      return isMemoryState(parsed) ? parsed : emptyMemory();
    } catch {
      return emptyMemory();
    }
  },
  save: async (state) => {
    await store.setItem(key, JSON.stringify(state));
  },
});

const isMemoryState = (value: unknown): value is MemoryState =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as MemoryState).summary === "string" &&
  Array.isArray((value as MemoryState).recent);

export { keyValueMemory };
export type { KeyValueStore };
