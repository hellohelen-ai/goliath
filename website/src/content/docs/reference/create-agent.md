---
title: createAgent
description: Create an agent from a model, tools, memory, and a fallback.
---

```ts
import { createAgent } from "@hellohelen-ai/goliath";

const agent = createAgent(config);
const result = await agent.run(ask, { conversationId, signal, onEvent, confirm });
agent.isSessionFallback(conversationId); // boolean
agent.sessionFallback; // default conversation
```

## Config

| Option         | Default                     | Notes                                                                       |
| -------------- | --------------------------- | --------------------------------------------------------------------------- |
| `outputSchema` | none                        | Zod schema for guided structured device answers; keep it flat               |
| `model`        | required                    | Any AI SDK `LanguageModel`                                                  |
| `tools`        | `{}`                        | Keep to five or fewer per agent. Flat schemas. One-sentence descriptions    |
| `memory`       | in-process per conversation | Default `Memory` object or `(conversationId) => Memory` factory             |
| `fallback`     | none                        | Receives the ask, the brief, the step log, and the reason. Returns text     |
| `confirm`      | approve ordinary tools      | Asked before writes; `requiresConfirmation` tools decline without a handler |
| `window`       | `4096`                      | Apple Foundation Models. The brief is budgeted at one eighth of it          |
| `maxSteps`     | `5`                         | Maximum steps per turn                                                      |
| `instructions` | a careful assistant         | One or two sentences. Every prompt starts with it                           |
| `facts`        | none                        | `Record<string, string>` or a function called once per turn                 |
| `examples`     | none                        | Two or three worked plans for the conductor. ~60 tokens per step each       |
| `compressors`  | none                        | Deprecated; never invoked. Use lifecycle extensions instead                 |
| `extensions`   | `[]`                        | Ordered, awaited [lifecycle hooks](/goliath/guides/extensions/)             |
| `onEvent`      | none                        | Every trace event as it happens                                             |

The `tools` map is re-keyed by each tool's own `name`, so the property names you use do not
matter.

## `run(ask, options?)`

| Option           | Notes                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `outputSchema`   | Overrides the config schema for this turn and infers its output type                           |
| `signal`         | An `AbortSignal`, passed to tools and the fallback                                             |
| `onEvent`        | Called for this turn's events, in addition to the config-level hook                            |
| `conversationId` | Nonempty string selecting isolated memory and session state; omit for the default conversation |
| `confirm`        | Approval handler for this run; overrides the config-level handler                              |

Runs in the same conversation are queued in order; different conversations can run concurrently.
The default conversation is separate from every named ID. IDs select state and are not automatically
injected into model prompts. A memory factory is required when combining named conversations with
custom memory; see [Memory](/goliath/guides/memory/).

`run` also accepts `context`, application data passed to extensions and tools without automatic
prompt or memory injection. With `createAgent<AppContext>(config)`, the context argument is
required and checked against `AppContext`; existing untyped `run(ask)` calls still work.

Returns a [`RunResult`](/goliath/reference/results/), including stop provenance and cleanup
diagnostics when applicable. See [Lifecycle extensions](/goliath/guides/extensions/) for the hook
contract. `window` must be positive and finite; `maxSteps` must be a nonnegative integer.

## Structured answers

```ts
import { z } from "zod";

const outputSchema = z.object({ reply: z.string(), action: z.enum(["rest", "walk"]) });
const agent = createAgent({ model, outputSchema });
const result = await agent.run("Suggest a small action");
result.output; // { reply: string; action: "rest" | "walk" } | undefined

const count = await agent.run("Count my tasks", {
  outputSchema: z.object({ count: z.number() }),
});
count.output; // { count: number } | undefined
```

`GoliathConfig<C, T>`, `Agent<C, T>`, and `RunOptions<C, T>` retain application context as their
first type parameter and use the second for structured output. `createAgent` infers both from
the config. If you explicitly supply a context type, supply the output type too:
`createAgent<AppContext, z.infer<typeof outputSchema>>(config)`. Per-run schemas infer their
output independently and still require the configured application context.

The existing answer call uses guided structured generation. Keep schemas flat and small: a
roughly 3B model can produce valid JSON while still getting complex answers wrong. The serialized
schema counts toward the input budget; the output cap remains 384 tokens. No schema means no
additional tokens or calls. Invalid JSON or schema validation triggers one retry with a short
correction, then `answer-invalid` escalation. Without fallback, exhausted validation returns
empty text and no output. Best-effort device answers also use the schema and one retry.

See [Results and events](/goliath/reference/results/) for `text`, `output`, and lifecycle semantics.

## `sessionFallback`

Reports the default conversation: `true` once three turns in a row died on the device with a model
error. Later turns in that conversation go straight to the fallback, if one is configured, without
calling the model. Use `agent.isSessionFallback(conversationId)` for named conversations; their
error counts are independent. An unused conversation reports `false`.

## Exported constants

| Name                | Value  |
| ------------------- | ------ |
| `DEFAULT_WINDOW`    | `4096` |
| `DEFAULT_MAX_STEPS` | `5`    |

## Literal tool output budgets

`budgets.toolResultTokens` defaults to `min(800, floor(window / 8))`, with a minimum of one.
`budgets.retrievedContextTokens` defaults to `min(2000, floor(window / 4))`, also at least one.
Both overrides must be positive integer token counts, and a result must fit within the aggregate
allowance. These limits apply to tools with `outputMode: "content"`; ordinary summaries retain
their 600-character cap. Newer excerpts take priority in model prompts. The run transcript keeps
the original excerpts, and the whole-prompt budget guard remains in force.

`countTokens` accepts an async or synchronous provider tokenizer. `window` also accepts an async
or synchronous function returning the model's current context size.
See [Virtual files](/goliath/guides/filesystem/) for storage and tool configuration.
