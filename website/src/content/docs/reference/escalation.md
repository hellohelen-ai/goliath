---
title: Escalation reasons
description: Every reason a turn leaves the device.
---

`FallbackRequest.reason` and the `escalate` trace event carry one of these.

| Reason               | When                                                                         |
| -------------------- | ---------------------------------------------------------------------------- |
| `no-model`           | No model was configured                                                      |
| `model-unavailable`  | Apple Intelligence is unavailable, disabled, or its models are not ready     |
| `too-many-steps`     | The step cap was reached without an answer                                   |
| `repeated-tool-call` | The same tool was called with the same input twice                           |
| `empty-answer`       | The answer was empty after one nudged retry                                  |
| `plan-invalid`       | Two malformed plans in a row                                                 |
| `conductor-asked`    | The conductor returned `kind: "escalate"`                                    |
| `tool-args-invalid`  | Two malformed argument objects in a row                                      |
| `tool-error`         | Two tool errors in a row                                                     |
| `guardrail`          | Apple's guardrail rejected the text. Ends on device; never sent to the cloud |
| `model-error`        | Refusal, overflow, or another provider error. Never retried                  |

Three `model-error` turns in a row set [`sessionFallback`](/goliath/reference/create-agent/#sessionfallback).
