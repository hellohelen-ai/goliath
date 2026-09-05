---
title: Memory adapters
description: inMemory, keyValueMemory, emptyMemory, and the Memory interface.
---

```ts
type MemoryState = { summary: string; recent: Exchange[] };
type Exchange = { ask: string; answer: string; at: number };
type Memory = {
  load: () => Promise<MemoryState>;
  save: (state: MemoryState) => Promise<void>;
};
```

## `inMemory(initial?)`

Memory that lives for the process. The default. Accepts an initial state, for tests.

## `keyValueMemory(store, key?)`

Memory persisted as one JSON string under `key` (default `"goliath.memory"`). Corrupt data reads as
empty.

```ts
type KeyValueStore = {
  getItem: (key: string) => Promise<string | null> | string | null;
  setItem: (key: string, value: string) => Promise<void> | void;
};
```

AsyncStorage matches this as is. For MMKV:

```ts
keyValueMemory({
  getItem: (k) => storage.getString(k) ?? null,
  setItem: (k, v) => storage.set(k, v),
});
```

## `emptyMemory()`

Returns `{ summary: "", recent: [] }`. Useful when writing your own adapter.

See the [Memory guide](/goliath/guides/memory/) for how the scribe fills these.
