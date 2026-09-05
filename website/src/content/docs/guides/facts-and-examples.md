---
title: Facts and examples
description: Two ways to help the conductor without adding a tool.
---

## Facts

Values the model should always have arrive as `key: value` lines in every conductor prompt.
Today's date, the timezone, the user's name. Apple's guidance is to run the tool before the model
when the model always needs the result; facts are that rule as config.

```ts
createGoliath({
  model: apple(),
  tools,
  facts: () => ({
    today: new Date().toDateString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    user: profile.firstName,
  }),
});
```

A function is called once per turn. A plain object is used as is.

## Examples

Two or three worked plans shown to the conductor. The format is fixed by guided generation, so
examples do not buy format; they buy tool choice and ordering.

```ts
createGoliath({
  model: apple(),
  tools,
  examples: [
    {
      ask: "what's on my list",
      steps: [{ tool: "listTasks", brief: "see what is open" }, { answer: "read the list back" }],
    },
    {
      ask: "add buy eggs unless it's there",
      steps: [
        { tool: "listTasks", brief: "check for eggs" },
        { tool: "createTask", brief: "add buy eggs" },
        { answer: "confirm what changed" },
      ],
    },
  ],
});
```

Each example costs about 60 tokens per step. Measure with the [evals](/goliath/guides/evals/) before
keeping any.
