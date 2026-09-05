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

| Field           | Type                                            | Notes                                                                  |
| --------------- | ----------------------------------------------- | ---------------------------------------------------------------------- |
| `name`          | `string`                                        | What the conductor picks by. Also the key in the tools map             |
| `description`   | `string`                                        | One sentence. Read on every step                                       |
| `parameters`    | `z.ZodType<INPUT>`                              | Flat: primitives and enums only                                        |
| `writes`        | `boolean`                                       | `true` when the tool changes something. Goliath asks before running it |
| `requires`      | `string[]`                                      | Tools that must have run earlier in the turn                           |
| `execute`       | `(input, context) => OUTPUT \| Promise<OUTPUT>` | `context.signal` is the turn's `AbortSignal`                           |
| `toModelOutput` | `(output: OUTPUT) => string`                    | What the model sees. Default: `key: value` lines capped at 600 chars   |

See the [Tools guide](/goliath/guides/tools/) for what makes a tool work on a small model.
