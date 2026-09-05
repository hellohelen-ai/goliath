---
title: Tracing
description: Watch every stage of a turn as it happens.
---

Pass `onEvent` to `createGoliath` for every turn, or to `run` for one. Both are called.

```ts
const result = await goliath.run(ask, {
  onEvent: (event) => {
    if (event.type === "plan")
      log(`${event.index}: ${event.kind} ${event.tool ?? ""} — ${event.brief}`);
    if (event.type === "tool") log(`  ${event.tool} ${event.ms}ms`);
    if (event.type === "escalate") log(`  → cloud (${event.reason})`);
  },
});
```

| Event      | When                                     | Carries                                    |
| ---------- | ---------------------------------------- | ------------------------------------------ |
| `recall`   | Memory loaded                            | `summary`, `recent` count                  |
| `plan`     | The conductor decided a step             | `index`, `kind`, `tool?`, `why?`, `brief`  |
| `confirm`  | A write was approved or declined         | `tool`, `approved`, `reason?`              |
| `tool`     | A tool ran                               | `tool`, `input`, compressed `result`, `ms` |
| `answer`   | The answer was written                   | `text`                                     |
| `escalate` | The turn left the device                 | `reason`, `error?`                         |
| `remember` | Memory saved                             | `summary`                                  |
| `budget`   | A prompt was measured against the window | `label`, `tokens`, `limit`                 |

Every event is also collected on `result.trace`, and the step log on `result.steps`. The
[example app](/goliath/project/example/) renders both on screen.

## Cancelling

`run(ask, { signal })` accepts an `AbortSignal`. It reaches every tool's `execute` through
`context.signal` and the fallback through `request.signal`.
