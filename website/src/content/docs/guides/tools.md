---
title: Tools
description: What a tool looks like when a 3B model has to read it on every step.
---

```ts
import { defineTool } from "@hellohelen-ai/goliath";
import { z } from "zod";

const completeTask = defineTool({
  name: "completeTask",
  description: "Mark a task done.",
  parameters: z.object({ title: z.string() }),
  writes: true,
  requires: ["listTasks"],
  execute: ({ title }) => tasks.complete(title),
  toModelOutput: (result) => `done: ${result.title}`,
});
```

`defineTool` is an identity function that pins the types. Everything it accepts is on
[the reference page](/goliath/reference/define-tool/). This page is about what makes a tool work
on a small model.

## Five or fewer

Each tool definition costs the conductor about 70 tokens on every step, and past about five
definitions a 3B model picks wrong or invents arguments. If your app has more, create more than one
agent, each with the tools one screen needs.

## Flat schemas

Primitives and enums. No nested objects, no unions, no arrays of objects. That is what a 3B model
fills in reliably and what Apple's guided generation accepts.

```ts
// Good
z.object({ title: z.string(), due: z.enum(["today", "tomorrow", "next week"]) });

// Will fail on device
z.object({ task: z.object({ title: z.string() }), tags: z.array(z.object({ name: z.string() })) });
```

## One-sentence descriptions

The description is read on every step. Say what the tool returns or does, in one sentence, and
stop.

## Say what a tool needs

`requires` lists tools that must run earlier in the turn. The conductor reads it as a sentence:
"Use `listTasks` before `completeTask`." This one line was TinyAgent's biggest plan-shape lever.

For values the model should always have, such as today's date or the user's name, do not write a
tool. Pass them as [facts](/goliath/guides/facts-and-examples/) instead.

## Shape what the model sees

The app keeps the full return value. The model gets `toModelOutput(result)`, or by default a set of
`key: value` lines capped at 600 characters. Use `toModelOutput` when the default keeps the wrong
fields.

## Errors are results

A tool that throws does not end the turn. The message becomes the step's result and the conductor
plans around it. Two errors in a row escalate.

## Missing values

A worker that cannot find a value in the brief names it instead of inventing one. The conductor
then decides whether to look it up or ask. "Wrong but valid" arguments are almost always invented
values, so this rule exists to stop them.
