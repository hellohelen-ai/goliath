import type { Exchange, Memory, MemoryState, StepRecord } from "../types.js";
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
  Array.isArray((value as MemoryState).recent) &&
  (value as MemoryState).recent.every(isExchange);

const isExchange = (value: unknown): value is Exchange => {
  if (typeof value !== "object" || value === null) return false;
  const exchange = value as Exchange;
  return (
    typeof exchange.ask === "string" &&
    typeof exchange.answer === "string" &&
    typeof exchange.at === "number" &&
    Number.isFinite(exchange.at) &&
    (exchange.steps === undefined ||
      (Array.isArray(exchange.steps) && exchange.steps.every(isStep)))
  );
};

const isStep = (value: unknown): value is StepRecord => {
  if (typeof value !== "object" || value === null) return false;
  const step = value as StepRecord;
  return (
    Number.isSafeInteger(step.index) &&
    step.index >= 0 &&
    (step.kind === "tool" || step.kind === "answer") &&
    typeof step.brief === "string" &&
    (step.result === undefined || typeof step.result === "string") &&
    (step.text === undefined || typeof step.text === "string")
  );
};

export { keyValueMemory };
export type { KeyValueStore };
