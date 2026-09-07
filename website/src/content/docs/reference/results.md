---
title: Results and events
description: RunResult, StepRecord, and TraceEvent.
---

## `RunResult`

```ts
type RunResult<T = unknown> = {
  text: string;
  output?: T;
  handledBy: "device" | "cloud";
  bestEffort?: boolean;
  steps: StepRecord[];
  trace: TraceEvent[];
  stopped?: { extension: string; phase: HookPhase; reason: string };
  diagnostics?: ExtensionDiagnostic[];
};
```

`bestEffort` is `true` when the loop stalled, no fallback was configured, and the answer was
written from the step log. `stopped` identifies an extension that ended the run with its own text.
`diagnostics` contains errors from `onError` or `onFinish` observers; these do not replace the
original outcome. See the [extension guide](/goliath/guides/extensions/#errors-cancellation-and-limits).

With `outputSchema`, `output` is the validated device answer, typed from the schema. `text`
contains the generated JSON, without a separate prose generation call. The SDK applies schema
transforms once; `text` retains the original JSON even when transforms change `output`.
`afterAnswer` can rewrite `text` for display without changing `output`. Answer events, answer
step records, and memory keep the final text; `onFinish` also sees `result.output`.

Structured output is device-only. Cloud fallback, extension stops, and failed generation omit
`output`, so callers must check it before use. Best-effort device answers can include validated
output but may describe an incomplete task; check `bestEffort` too. Without `outputSchema`, text
behavior is unchanged and `output` is absent.

## `StepRecord`

One step: what the conductor decided and what the worker did.

| Field        | Notes                                                               |
| ------------ | ------------------------------------------------------------------- |
| `index`      | Zero-based step number                                              |
| `kind`       | `"tool"` or `"answer"`                                              |
| `brief`      | The conductor's one line                                            |
| `tool`       | The tool name, for tool steps                                       |
| `input`      | The validated arguments                                             |
| `result`     | The compressed tool result the transcript carries forward           |
| `skipped`    | Execution was skipped by policy, confirmation, or missing arguments |
| `skipReason` | `"policy"`, `"confirmation"`, or `"missing"`                        |
| `extension`  | Name of the extension that denied execution                         |
| `cached`     | Served from an earlier identical read-only step; nothing ran        |
| `failed`     | The tool threw. `result` carries the message                        |
| `text`       | The answer, for answer steps                                        |

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

The example renders empty, stopped, or best-effort outcomes as unfinished, with the latest
escalation reason determining the message. “On-device” describes execution location; it does not
mean the request succeeded. A later failure does not roll back earlier tool effects.

Nonempty best-effort replies can be remembered: `Exchange.bestEffort?: boolean` marks their
partial status in recalled prompts and scribe input. The raw tool records remain available,
and prerequisites and approvals still apply to subsequent actions.
