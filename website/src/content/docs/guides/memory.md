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

One agent can serve multiple conversations using `agent.run(text, { conversationId })`. Each ID
gets its own memory and request queue; `run(text)` uses a separate default conversation.
Without an adapter, history lives in process for the lifetime of the agent instance.

For persistent named conversations, configure a factory:

```ts
const agent = createAgent({
  model,
  memory: (id) => keyValueMemory(storage, `goliath:${JSON.stringify(id ?? null)}`),
});
await agent.run("Remember my meeting", { conversationId: "work" });
```

The factory runs once per ID per agent instance, receiving `undefined` for the default conversation.
Return separate memory for each ID. A single `Memory` object is still supported for default runs,
but named runs reject that configuration to prevent sharing conversation history accidentally.
Memory adapters persist completed history; they do not checkpoint a running or approval-paused turn.

Two are built in. Any object with `load` and `save` over `MemoryState` works.

### `inMemory`

Lives for the process. The default, and what tests use.

```ts
import { inMemory } from "@hellohelen-ai/goliath";
createAgent({ model, memory: inMemory() });
```

### `keyValueMemory`

One JSON string under a key. Fits AsyncStorage as is; MMKV and expo-sqlite fit with a two-line
wrapper. Corrupt data reads as empty.

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { keyValueMemory } from "@hellohelen-ai/goliath";

createAgent({ model, memory: keyValueMemory(AsyncStorage, "assistant.memory") });
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

## Customizing recall and persistence

The [`afterRecall` hook](/goliath/guides/extensions/) changes the transient memory view for a turn.
Persistence starts from the originally loaded state, so those changes are not saved implicitly.
`beforeRemember` can replace the scribe's candidate or skip saving. Answer transformations run
before the exchange is saved; summaries and recent-history limits apply after memory transforms.

After model-error fallback, including cloud-only session turns, Goliath preserves the existing
summary and the latest three exchanges without calling the failed device again. Older exchanges
are dropped on this route. Best-effort answers without a fallback are not saved.
