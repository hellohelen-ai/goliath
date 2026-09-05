---
title: Memory
description: What Goliath remembers between turns, and where to keep it.
---

Memory is small on purpose:

```ts
type MemoryState = {
  summary: string; // a rolling brief, at most ~60 words
  recent: Exchange[]; // the last three exchanges, verbatim
};
```

The summary is budgeted at one eighth of the window. The scribe updates it in place only when an
exchange falls off the end of `recent`. It has a Pending slot and never lists finished work as
pending.

## Adapters

Two are built in. Any object with `load` and `save` over `MemoryState` works.

### `inMemory`

Lives for the process. The default, and what tests use.

```ts
import { inMemory } from "@hellohelen-ai/goliath";
createGoliath({ model, memory: inMemory() });
```

### `keyValueMemory`

One JSON string under a key. Fits AsyncStorage as is; MMKV and expo-sqlite fit with a two-line
wrapper. Corrupt data reads as empty.

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { keyValueMemory } from "@hellohelen-ai/goliath";

createGoliath({ model, memory: keyValueMemory(AsyncStorage, "assistant.memory") });
```

### Your own

```ts
const memory: Memory = {
  load: async () => (await db.get("memory")) ?? emptyMemory(),
  save: async (state) => db.put("memory", state),
};
```

## What the fallback sees

When a turn escalates, the fallback receives `summary` and `recent` alongside the step log. The
cloud agent starts where the phone stopped, not from scratch.
