---
title: defineTool
description: Declare a tool the phone's model may call.
---

```ts
import { defineTool } from "@hellohelen-ai/goliath";

const tool = defineTool({
  name,
  description,
  parameters,
  writes,
  requires,
  execute,
  toModelOutput,
});
```

`defineTool` is an identity function that pins `INPUT` and `OUTPUT` from `parameters` and
`execute`. The result is a `GoliathTool`.

| Field           | Type                                            | Notes                                                                                      |
| --------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `name`          | `string`                                        | What the conductor picks by. Also the key in the tools map                                 |
| `description`   | `string`                                        | One sentence. Read on every step                                                           |
| `parameters`    | `z.ZodType<INPUT>`                              | Flat: primitives and enums only                                                            |
| `writes`        | `boolean`                                       | `true` when the tool changes something. Goliath asks before running it                     |
| `requires`      | `string[]`                                      | Tools that must have run earlier in the turn                                               |
| `execute`       | `(input, context) => OUTPUT \| Promise<OUTPUT>` | `context.signal` is the turn's `AbortSignal`; `context.context` holds application run data |
| `toModelOutput` | `(output: OUTPUT) => string`                    | What the model sees. Default: `key: value` lines capped at 600 chars                       |

`outputMode: "content"` opts into token-budgeted literal excerpts instead of the 600-character
summary limit. `context.resultBudget` supplies `maxTokens` and the optional provider
`countTokens` function. The harness also caps results after `afterTool` hooks and limits
retrieved excerpts carried into subsequent model calls. Full recorded outputs remain available
to application code.

`requiresConfirmation: true` declines a writing tool unless an explicit config-level or per-run
confirmation handler approves it. Existing writing tools retain their prior default approval
behavior. This flag does not replace `writes: true`.

See the [Tools guide](/goliath/guides/tools/) for what makes a tool work on a small model.
