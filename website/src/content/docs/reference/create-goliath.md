---
title: createGoliath
description: Build a Goliath from a model, tools, memory, and a fallback.
---

```ts
import { createGoliath } from "@hellohelen-ai/goliath";

const goliath = createGoliath(config);
const result = await goliath.run(ask, { signal, onEvent });
goliath.sessionFallback; // boolean
```

## Config

| Option         | Default             | Notes                                                                      |
| -------------- | ------------------- | -------------------------------------------------------------------------- |
| `model`        | required            | Any AI SDK `LanguageModel`                                                 |
| `tools`        | `{}`                | Keep to five or fewer per Goliath. Flat schemas. One-sentence descriptions |
| `memory`       | in-process          | `{ load, save }` over `{ summary, recent }`. Persist it however you like   |
| `fallback`     | none                | Receives the ask, the brief, the step log, and the reason. Returns text    |
| `confirm`      | approve all         | Asked before any `writes: true` tool runs                                  |
| `window`       | `4096`              | Apple Foundation Models. The brief is budgeted at one eighth of it         |
| `maxSteps`     | `5`                 | Five stones                                                                |
| `instructions` | a careful assistant | One or two sentences. Every prompt starts with it                          |
| `facts`        | none                | `Record<string, string>` or a function called once per turn                |
| `examples`     | none                | Two or three worked plans for the conductor. ~60 tokens per step each      |
| `compressors`  | none                | Extra compressors run after the built-in structural pass                   |
| `onEvent`      | none                | Every trace event as it happens                                            |

The `tools` map is re-keyed by each tool's own `name`, so the property names you use do not
matter.

## `run(ask, options?)`

| Option    | Notes                                                               |
| --------- | ------------------------------------------------------------------- |
| `signal`  | An `AbortSignal`, passed to tools and the fallback                  |
| `onEvent` | Called for this turn's events, in addition to the config-level hook |

Returns a [`RunResult`](/goliath/reference/results/).

## `sessionFallback`

`true` once three turns in a row died on the device with a model error. Later turns go straight to
the fallback, if one is configured, without calling the model.

## Exported constants

| Name                | Value  |
| ------------------- | ------ |
| `DEFAULT_WINDOW`    | `4096` |
| `DEFAULT_MAX_STEPS` | `5`    |
