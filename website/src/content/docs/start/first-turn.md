---
title: Your first turn
description: Two tools, a confirmation, and a fallback, in thirty lines.
---

```ts
import { createAgent, defineTool } from "@hellohelen-ai/goliath";
import { apple } from "@react-native-ai/apple";
import { z } from "zod";

const listTasks = defineTool({
  name: "listTasks",
  description: "The user's open tasks.",
  parameters: z.object({}),
  execute: () => convex.query(api.tasks.list, {}),
});

const createTask = defineTool({
  name: "createTask",
  description: "Add a task.",
  parameters: z.object({ title: z.string() }),
  writes: true, // confirmed before it runs
  execute: ({ title }) => convex.mutation(api.tasks.create, { title }),
});

const agent = createAgent({
  model: apple(),
  tools: { listTasks, createTask },
  confirm: async ({ tool, input }) => askTheUser(tool, input),
  fallback: async ({ ask, summary, steps }) => cloudAgent.turn({ ask, summary, steps }),
});

const result = await agent.run("if I don't already have it, add call the dentist");
result.text; // "Added Call the dentist. You now have three open tasks."
result.handledBy; // "device" | "cloud"
result.steps; // what it did, one line each
```

## What happened

1. **Recall.** Goliath loaded the memory brief. On a first run it is empty.
2. **Conduct.** The model read the ask and planned one step: `listTasks`.
3. **Work.** A worker ran `listTasks`. Its output was compressed to a few `key: value` lines.
4. **Conduct again.** The conductor saw one line for that step and planned `createTask`.
5. **Confirm.** `createTask` writes, so your `confirm` was called first.
6. **Work.** A worker asked the model for `{ title }` as structured output, then ran the tool.
7. **Answer.** The model wrote two sentences from the ask, the brief, and the step log.
8. **Remember.** The exchange was saved to memory.

The whole turn stayed on the device. Had the conductor stalled, `fallback` would have received
the ask, the brief, and the step log, and `handledBy` would be `"cloud"`.

## Keep going

- [Tools](/goliath/guides/tools/): what a good tool looks like for a 3B model.
- [Confirming writes](/goliath/guides/confirm/): the shape of `confirm`.
- [Testing without a phone](/goliath/guides/testing/): script the model and assert on prompts.
