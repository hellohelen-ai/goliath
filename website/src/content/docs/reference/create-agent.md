---
title: createAgent
description: Create an agent from a model, tools, memory, and a fallback.
---

```ts
import { createAgent } from "@hellohelen-ai/goliath";

const agent = createAgent(config);
const result = await agent.run(ask, { signal, onEvent });
agent.sessionFallback; // boolean
```

## Config

| Option         | Default             | Notes                                                                    |
| -------------- | ------------------- | ------------------------------------------------------------------------ |
| `model`        | required            | Any AI SDK `LanguageModel`                                               |
| `tools`        | `{}`                | Keep to five or fewer per agent. Flat schemas. One-sentence descriptions |
| `memory`       | in-process          | `{ load, save }` over `{ summary, recent }`. Persist it however you like |
| `fallback`     | none                | Receives the ask, the brief, the step log, and the reason. Returns text  |
| `confirm`      | approve all         | Asked before any `writes: true` tool runs                                |
| `window`       | `4096`              | Apple Foundation Models. The brief is budgeted at one eighth of it       |
| `maxSteps`     | `5`                 | Maximum steps per turn                                                   |
| `instructions` | a careful assistant | One or two sentences. Every prompt starts with it                        |
| `facts`        | none                | `Record<string, string>` or a function called once per turn              |
| `examples`     | none                | Two or three worked plans for the conductor. ~60 tokens per step each    |
| `compressors`  | none                | Deprecated; never invoked. Use lifecycle extensions instead              |
| `extensions`   | `[]`                | Ordered, awaited [lifecycle hooks](/goliath/guides/extensions/)          |
| `onEvent`      | none                | Every trace event as it happens                                          |

The `tools` map is re-keyed by each tool's own `name`, so the property names you use do not
matter.

## `run(ask, options?)`

| Option    | Notes                                                               |
| --------- | ------------------------------------------------------------------- |
| `signal`  | An `AbortSignal`, passed to tools and the fallback                  |
| `onEvent` | Called for this turn's events, in addition to the config-level hook |

`run` also accepts `context`, application data passed to extensions and tools without automatic
prompt or memory injection. With `createAgent<AppContext>(config)`, the context argument is
required and checked against `AppContext`; existing untyped `run(ask)` calls still work.

Returns a [`RunResult`](/goliath/reference/results/), including stop provenance and cleanup
diagnostics when applicable. See [Lifecycle extensions](/goliath/guides/extensions/) for the hook
contract. `window` must be positive and finite; `maxSteps` must be a nonnegative integer.

## `sessionFallback`

`true` once three turns in a row died on the device with a model error. Later turns go straight to
the fallback, if one is configured, without calling the model.

## Exported constants

| Name                | Value  |
| ------------------- | ------ |
| `DEFAULT_WINDOW`    | `4096` |
| `DEFAULT_MAX_STEPS` | `5`    |
