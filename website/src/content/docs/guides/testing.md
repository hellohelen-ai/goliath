---
title: Testing without a phone
description: Script the model and assert on exactly what the harness sent.
---

`@hellohelen-ai/goliath/testing` exports `fakeModel`, an AI SDK language model that reads from a
script.

```ts
import { createGoliath } from "@hellohelen-ai/goliath";
import { fakeModel } from "@hellohelen-ai/goliath/testing";

const model = fakeModel([
  { json: { kind: "tool", tool: "listTasks", brief: "see what is open" } },
  { toolCall: { name: "listTasks", input: {} } },
  { json: { kind: "answer", brief: "reply" } },
  { text: "You have two tasks: buy milk and call mom." },
]);

const goliath = createGoliath({ model, tools: { listTasks } });
const result = await goliath.run("what's on my list");

expect(result.handledBy).toBe("device");
expect(model.remaining()).toBe(0);
```

## Three kinds of reply

| Reply                           | Used for                                             |
| ------------------------------- | ---------------------------------------------------- |
| `{ json }`                      | A conductor plan or a worker's arguments             |
| `{ toolCall: { name, input } }` | A worker step, when the provider returns a tool call |
| `{ text }`                      | The answer, or the scribe's brief                    |

## Why running out is an error

The script is consumed in order and the model throws when it is empty. A passing test therefore
proves the harness sent exactly the prompts you scripted, no more. Assert `model.remaining()` is
zero at the end to prove it sent no fewer.

## Asserting on prompts

`model.calls` holds every call the harness made, in order, with the full prompt. Prompt changes
are tested as prompts in this project: if you change what the conductor reads, assert the new
shape.

```ts
const conductorPrompt = JSON.stringify(model.calls[0].prompt);
expect(conductorPrompt).toContain("Use listTasks before completeTask.");
```
