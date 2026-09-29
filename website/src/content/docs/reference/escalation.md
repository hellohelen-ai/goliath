---
title: Escalation reasons
description: Every reason a turn leaves the device.
---

`FallbackRequest.reason` and the `escalate` trace event carry one of these.

| Reason               | When                                                                         |
| -------------------- | ---------------------------------------------------------------------------- |
| `no-model`           | No model was configured                                                      |
| `model-unavailable`  | Provider reports `MODEL_UNAVAILABLE` or `UNSUPPORTED_OS`                     |
| `too-many-steps`     | The step cap was reached without an answer                                   |
| `repeated-tool-call` | The same tool was called with the same input twice                           |
| `answer-invalid`     | Structured answer failed JSON parsing or schema validation after one retry   |
| `empty-answer`       | The answer was empty after one nudged retry                                  |
| `plan-invalid`       | Two malformed plans in a row                                                 |
| `conductor-asked`    | The conductor returned `kind: "escalate"`                                    |
| `tool-args-invalid`  | Two malformed argument objects in a row                                      |
| `tool-error`         | Two tool errors in a row                                                     |
| `guardrail`          | Apple's guardrail rejected the text. Ends on device; never sent to the cloud |
| `model-error`        | Unclassified provider error. Never retried                                   |

Three `model-error` turns in a row set [`sessionFallback`](/goliath/reference/create-agent/#sessionfallback).

`context-budget` covers the harness budget guard and a provider's `CONTEXT_WINDOW_EXCEEDED`
code. `tool-prerequisite-missing` means a tool's required prior lookup has not succeeded.

Error codes are read through wrapped causes, with guardrail refusals taking priority. Legacy
unsafe-content messages are still recognized. Unknown provider errors retain `model-error`;
Goliath does not assume every provider exposes structured native errors. Tool, hook, and storage
failures are not classified as provider failures.

`model-unavailable` and `context-budget` do not latch a conversation into permanent session
fallback. They may recover on a later turn. Neither calls the failed device again for a
best-effort answer or to summarize a fallback reply.
