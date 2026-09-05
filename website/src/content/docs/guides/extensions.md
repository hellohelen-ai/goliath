---
title: Lifecycle extensions
description: Customize planning, tools, fallback, answers, and memory with typed lifecycle hooks.
---

`createGoliath({ extensions: [...] })` accepts named objects implementing `GoliathExtension`.
All hooks are optional, synchronous or asynchronous, and run sequentially in registration order,
including `after*` hooks. Names must be nonempty and unique. Factories can return extension objects
to package application-specific configuration; no plugin loader or runtime dependency is needed.

## Context and state

```ts
import { createGoliath, type GoliathExtension } from "@hellohelen-ai/goliath";

type Context = { timezone: string; allowCloud: boolean };

const contextExtension: GoliathExtension<Context> = {
  name: "application-context",
  beforeRun({ context, state }) {
    state.set("started", Date.now());
    return { facts: { timezone: context.timezone } };
  },
  onFinish({ state, outcome }) {
    console.log(outcome.status, Date.now() - Number(state.get("started")));
  },
};

const goliath = createGoliath<Context>({ model, extensions: [contextExtension] });
await goliath.run("What is on today?", {
  context: { timezone: "America/New_York", allowCloud: false },
});
```

A concrete context type makes `run`'s context argument required. Without one, existing calls to
`run(ask)` still work. Every hook receives `runId`, `context`, `signal`, and `state`, alongside the
phase data below. `signal` is undefined when none was supplied. Tools receive the application data
as `ToolContext.context` (typed `unknown` by default).

The private `state: Map<string, unknown>` is allocated independently for each extension and run.
Do not store run counters in shared extension fields. Plain objects and arrays in phase data are
copied; return values are validated before use. Treat opaque values such as errors and class
instances, and the application-owned context, as read-only. They are not cloned or sandboxed.
Context and private state are never automatically serialized into model prompts, memory, traces,
or cloud requests. Explicitly returning a fact or other text makes that selected data visible.

Concurrent calls isolate extension state. Shared memory storage still uses `load`/`save`, not
transactions: applications must coordinate overlapping turns that write the same memory.

## Hooks

Every method can return `void` to preserve the current value. Patches below are explicit field
replacements, except `facts`, whose keys merge with later values winning.

| Hook             | Phase data                                           | Return value besides `void`                  |
| ---------------- | ---------------------------------------------------- | -------------------------------------------- |
| `beforeRun`      | `ask`, `instructions`, `facts`                       | `{ ask?, instructions?, facts? }` or stop    |
| `afterRecall`    | `memory`                                             | `{ memory }`, a transient view for this run  |
| `beforePlan`     | `ask`, `tools`, `contextText`, `steps`, `attempt`    | `{ tools?: string[], contextText?: string }` |
| `afterPlan`      | `plan`, `tools`, `steps`, `attempt`                  | `{ plan }` or stop                           |
| `beforeTool`     | `tool`, `input`, `brief`, `steps`                    | `{ input }`, deny, or stop                   |
| `afterTool`      | `tool`, `input`, `result`, `outcome`, prior `steps`  | `{ result: string }`                         |
| `beforeFallback` | `request` without its signal                         | `{ request }` or stop                        |
| `afterAnswer`    | `text`, `handledBy`, `bestEffort`, `steps`           | `{ text }` or stop                           |
| `beforeRemember` | candidate `memory`, current `exchange`               | `{ memory }` or `{ action: "skip" }`         |
| `onError`        | original `error`, `origin`, partial `steps`, `trace` | Observation only                             |
| `onFinish`       | `outcome`, secondary `diagnostics`                   | Observation and cleanup only                 |

Tools in hook inputs are descriptors with `name`, `description`, and `writes`, not executable
objects. Planning attempts start at zero for each step and increment on a malformed-plan retry.
When no tools remain, planning hooks surround the synthetic answer plan without a planner call.
`beforePlan.contextText` augments the planner's instructions for that attempt only; use
`beforeRun.instructions` for instructions shared with workers and answers.

`beforeTool` runs once arguments are available and validated, including for no-argument tools and
candidate cached reads. A missing-argument result skips execution and goes directly to
`afterTool`. Invalid generated arguments request normal escalation. Invalid rewritten arguments
are extension errors and never reach confirmation or execution.

Generated arguments use the AI SDK's validated output, so schema transformations run once.
Returning `{ input }` supplies a fresh schema input to validate and transform; return `void` when
preserving the current arguments. No-argument calls are validated locally without a model call.

`afterTool.outcome` is a discriminated union:

- `{ status: "executed", output }` exposes the successful raw output only during hooks.
- `{ status: "cached", fromStep }` identifies the earlier successful read; no raw output exists.
- `{ status: "skipped", reason, extension? }` distinguishes `policy`, `confirmation`, and `missing`.
- `{ status: "failed", error }` describes a tool exception that the conductor can plan around.

Only the transformed result string reaches the step log and tool event. A provisional step is
retained for finalization if execution, output formatting, or a hook fails, so an effect is not
lost from the diagnostic record. There is no automatic rollback or retry of an executed tool.

## Decisions and ordering

```ts
// A skipped tool step; the conductor may choose another action.
return { action: "deny", reason: "Read access is disabled." };

// Finish this run immediately with application-selected text.
return { action: "stop", text: "Cloud processing is disabled.", reason: "cloud-disabled" };
```

A denial ends the `beforeTool` chain and records `skipped: true`, `skipReason: "policy"`, and the
extension name. It consumes a step. A user confirmation decline has `skipReason: "confirmation"`.
A stop ends the run and adds `result.stopped = { extension, phase, reason }`. Stop text bypasses
answer transforms and persistence; only finalizers run. `handledBy` records the actual route:
`device` before any cloud call, `cloud` once a handoff has begun. Skip ends `beforeRemember`
without saving and cannot be reversed by a later hook.

Transformations run in array order. Place argument normalization before policies that need to
inspect final arguments. All rewrites finish before `confirm`, and execution receives a copy of
the exact approved values. Confirmation callbacks cannot alter the actual call by mutating their
request. Tool filtering intersects the existing set, so later hooks cannot re-enable filtered
names during the same attempt. Replacement plans are checked against the available set.

Cached reads pass through `beforeTool`; changing arguments invalidates a cache candidate. Failed
and skipped steps never become successful cached reads. Identical calls are detected before
execution, including writes. `afterTool` changes presentation without changing execution status.

## Answers, fallback, and memory

`afterAnswer` runs once a nonempty final device, cloud, or best-effort answer exists, before its
answer event, answer step (when present), saved exchange, and returned text. All carry the same
transformed text. Returning an empty answer is an extension error, not a request for model retry.
An empty provider-guardrail result stays on device and does not invoke answer or fallback hooks.

`beforeFallback` runs only when a fallback will actually be called. Its request is a copy, so
redacting it does not alter the local step log or persistence base. Preserve the escalation
`reason`; the signal belongs to the run and cannot be replaced through the payload. Cloud-only
session fallback uses the same start, recall, policy, answer, memory, and finalization hooks.

`afterRecall` edits are transient. Persistence starts from the originally loaded memory, the
current ask and transformed answer, and the scribe's candidate. `beforeRemember` can replace that
candidate or skip saving. Best-effort answers retain the existing behavior of not being saved.

After a model-error handoff, including session fallback, Goliath retains the previous summary and
the latest three exchanges without asking the failed device to summarize. Older exchanges are
dropped on this route. Normal routes use the scribe to fold evicted exchanges into the summary.
A scribe failure after producing an answer rejects instead of executing the turn again in cloud.

## Errors, cancellation, and limits

Transformation/decision hook failures reject with exported `GoliathExtensionError`, including
`extension`, `phase`, and `cause`. Application errors retain their original rejection values;
`onError.origin` distinguishes extension, model, memory, confirmation, fallback, formatter,
event, config, budget, tool, and harness errors. Only provider failures in the active device loop
request model-error fallback. Hook errors do not increment the session model-failure counter.

`onFinish` runs once per extension for completed, stopped, error, and aborted outcomes, including
extensions whose earlier hooks were not reached. Errors and aborts also invoke `onError` first.
Observer failures never replace the original result or rejection and never prevent later
observers from running. Later finalizers can inspect accumulated secondary diagnostics;
successful or stopped results retain them in `result.diagnostics`.

Cancellation is checked around awaited hooks and before effects. An already-aborted run still
notifies error/finalization hooks. Callbacks receive the signal and should cooperate with it;
the harness cannot forcibly interrupt arbitrary JavaScript or undo a started side effect.
Cleanup hooks still run after cancellation. There are no automatic hook timeouts.

With extensions configured, tool result strings are capped at 600 characters and prompts must
fit within 70% of the configured window after the conductor's structural trimming. This check
covers planning, argument generation, answers/retries/best effort, and the scribe. Oversized
protected text rejects with exported `GoliathBudgetError` before a provider call. Estimates cover
rendered text, not an exact provider tokenizer; the remaining 30% reserves space for output and
schema/provider overhead. Existing no-extension prompt behavior is preserved.

Saved summaries are capped at one eighth of the window using the token estimator, and saved
recent history is limited to three exchanges, including after memory transformations. Registering
an extension itself adds no model tokens or model calls. The old `compressors` option remains
accepted for compatibility but is deprecated because it was never invoked; use `afterTool` and
`beforePlan` instead. Model wrappers, shell hooks, and plugin discovery are outside this API.
