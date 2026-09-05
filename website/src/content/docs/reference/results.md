---
title: Results and events
description: RunResult, StepRecord, and TraceEvent.
---

## `RunResult`

```ts
type RunResult = {
  text: string;
  handledBy: "device" | "cloud";
  bestEffort?: boolean;
  steps: StepRecord[];
  trace: TraceEvent[];
};
```

`bestEffort` is `true` when the loop stalled, no fallback was configured, and the answer was
written from the step log.

## `StepRecord`

One stone thrown: what the conductor decided and what the worker did.

| Field     | Notes                                                        |
| --------- | ------------------------------------------------------------ |
| `index`   | Zero-based step number                                       |
| `kind`    | `"tool"` or `"answer"`                                       |
| `brief`   | The conductor's one line                                     |
| `tool`    | The tool name, for tool steps                                |
| `input`   | The validated arguments                                      |
| `result`  | The compressed tool result the transcript carries forward    |
| `skipped` | The user declined the write                                  |
| `cached`  | Served from an earlier identical read-only step; nothing ran |
| `failed`  | The tool threw. `result` carries the message                 |
| `text`    | The answer, for answer steps                                 |

## `TraceEvent`

```ts
type TraceEvent =
  | { type: "recall"; summary: string; recent: number }
  | {
      type: "plan";
      index: number;
      kind: "tool" | "answer";
      tool?: string;
      why?: string;
      brief: string;
    }
  | { type: "confirm"; tool: string; approved: boolean; reason?: string }
  | { type: "tool"; tool: string; input: unknown; result: string; ms: number }
  | { type: "answer"; text: string }
  | { type: "escalate"; reason: EscalationReason; error?: string }
  | { type: "remember"; summary: string }
  | { type: "budget"; label: string; tokens: number; limit: number };
```

See the [Tracing guide](/goliath/guides/tracing/) for when each fires.
