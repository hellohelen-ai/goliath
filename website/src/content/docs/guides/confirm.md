---
title: Confirming writes
description: Ask the user before a tool changes anything.
---

Mark a tool `writes: true` and Goliath calls your `confirm` before it runs.

```ts
const agent = createAgent({
  model: apple(),
  tools: { listTasks, createTask },
  confirm: async ({ tool, input, brief }) => {
    const ok = await showSheet(`${brief}?`, input);
    return ok ? true : { approved: false, reason: "not today" };
  },
});
```

`confirm` receives:

| Field   | What it is                                       |
| ------- | ------------------------------------------------ |
| `tool`  | The tool's name                                  |
| `input` | The validated arguments the worker produced      |
| `brief` | The conductor's one-line description of the step |

It returns `true`, `false`, or `{ approved, reason? }`.

## A declined write carries the reason

If you return a reason, it reaches the conductor worded as a decision the model must not retry.
Without one, the model may plan the same write again with a slightly different brief. The step is
recorded with `skipped: true`.

## The confirm happens outside the model call

Goliath asks for the arguments, then confirms, then runs the tool. The model session is not open
while the user is deciding, so a slow user does not time out Apple's session.

## Default

With no `confirm`, ordinary writing tools are approved. A writing tool with
`requiresConfirmation: true` is declined instead; filesystem write tools set this flag.
Supply an explicit config-level or per-run confirmation handler to approve those tools.
