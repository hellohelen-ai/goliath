---
title: Testing utilities
description: fakeModel and friends from @hellohelen-ai/goliath/testing.
---

```ts
import { fakeModel } from "@hellohelen-ai/goliath/testing";
import type { FakeModel, ScriptedReply } from "@hellohelen-ai/goliath/testing";
```

## `fakeModel(script)`

A language model that reads from a script. Each call consumes the next reply. Running out throws
`fakeModel: script exhausted after N call(s)`.

```ts
type ScriptedReply =
  { text: string } | { json: unknown } | { toolCall: { name: string; input: unknown } };
```

The returned model adds two members:

| Member        | Notes                                                    |
| ------------- | -------------------------------------------------------- |
| `calls`       | Every prompt the harness sent, in order                  |
| `remaining()` | Replies not yet consumed. Zero at the end of a good test |

Token usage is estimated at four characters per token, so budget events fire realistically.

## Other exports

From the main entry, for tests that measure prompts:

| Export                | Notes                                                    |
| --------------------- | -------------------------------------------------------- |
| `estimateTokens`      | chars / 4 with a 15% margin                              |
| `fitWithin`           | Drop the oldest non-system messages first, keep the last |
| `transcriptTokens`    | Estimate for a list of messages                          |
| `summarizeToolResult` | The built-in structural compressor                       |
| `planSchema`          | The conductor's plan schema, as Zod                      |

See [Testing without a phone](/goliath/guides/testing/) for the pattern.
