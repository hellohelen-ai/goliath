---
title: Evals
description: Measure repeated task completion with real models and runtime token accounting.
---

Import the device-compatible runner from `@hellohelen-ai/goliath/evals`. It uses fresh memory and
an in-memory task list for every attempt. It does not execute your application's real tools.
The built-in fixtures cover task listing, creation, prerequisite lookups, small talk, and handoff.
Use them as a starting point, then add representative asks and failure cases for your product.

## Scripted smoke test

```sh
bun run evals
```

This repository command always uses a scripted perfect model. It validates the runner, not model
quality or latency. Its output explicitly labels that distinction.

## Real model evaluation

Call this inside a native app with Apple Intelligence ready:

```ts
import { apple } from "@react-native-ai/apple";
import { fixtures, runEvals, formatReport } from "@hellohelen-ai/goliath/evals";
import { appleContextOptions } from "./modules/goliath-context";

const controller = new AbortController();
const report = await runEvals({
  fixtures,
  model: () => () => apple(),
  ...appleContextOptions(),
  runs: 3,
  signal: controller.signal,
  metadata: {
    device: "your device model",
    osVersion: "your exact OS version",
    providerVersion: "your installed @react-native-ai/apple version",
    dataset: "your fixture revision",
  },
});
console.log(formatReport(report));
// Save JSON.stringify(report) with your development artifacts for comparison.
```

`appleContextOptions` is the example's local Expo module, not a library export. Copy that module
into your app, or supply your own `window` and `countTokens`. Omitting them retains the harness's
4,096-token default and conservative text estimate. Optional `budgets`, `maxSteps`, and
`instructions` let you match production settings.

The outer `model(fixture)` function runs once per attempt. Returning `() => apple()` gives the
harness a factory for each generation, matching the example agent. You can also return a model
instance for providers that do not need a fresh instance each call.

The example includes `runAppleEvals({ device, signal? })` in
`src/agents/goliath/evaluate.ts`. Invoke it explicitly from a development action with no other
model work running. It checks availability, uses the native token bridge, and repeats every
fixture three times. It does not run automatically when the app starts.

The default fallback returns a scripted acknowledgement. This measures whether handoff happened,
not the quality of a cloud answer. Supply `fallback` explicitly to evaluate a real cloud service;
that callback receives fixture data and may make network requests.

## Fixtures and reports

A `Fixture` has an `id`, `ask`, expected ordered `tools`, and `handledBy` (`device` or `cloud`).
`escalation` can be `forbidden`, `expected`, or `allowed`; its default comes from `handledBy`.
`mentions` and `forbids` contain lowercase answer substrings.
`expectedReason` optionally checks the final escalation reason, such as `guardrail` or
`context-budget`. Without it, an empty answer fails even if no cloud call occurred.

A fixture passes only when every attempt passes (**pass^k**). `runs` must be a positive integer.
Each outcome retains all `attempts`, its pass count, and failure reasons labeled with the run
number. Its top-level `text`, `tools`, `handledBy`, `ms`, and `steps` describe the **last attempt**;
use `attempts` for per-run analysis. Earlier failures remain visible when the last run passes.

Report `total` and `passed` count fixtures. `totalRuns`, `onDevice`, `escalated`, `errors`, and
`meanSteps` aggregate **all attempts**. `errors` means execution threw before returning a result;
these attempts fail and are distinct from device responses or successful cloud handoffs. They
record zero steps because a completed trace is unavailable. Cancellation rejects the evaluation
instead of being scored as a model-quality failure. Caller metadata is copied into the report.

## Release validation

Compare supported iOS versions and hardware with the same dataset, model/provider versions,
runtime capacity, and settings. Keep cold/warm latency measurements separate; this runner records
wall-clock time per attempt but does not control model warmup. Re-run after OS or provider updates.
Add cases for Unicode, long inputs, structured-output failures, unavailable models, safety
refusals, and interrupted turns. A passing scripted test does not establish device reliability.

Apple's [Evaluations framework](https://developer.apple.com/documentation/evaluations) can add
Swift datasets and model judges for native integrations. The JavaScript runner remains independent
of that framework and works with the existing provider.
