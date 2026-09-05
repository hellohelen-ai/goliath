# Design notes

Three research briefs on the platform and five on what was built for small on-device models sit
under `research/`. Each claim in them carries a source. The eight briefs on other agent harnesses
live in the [helen repo](https://github.com/hellohelen-ai/helen/tree/main/docs/research/harnesses);
[`research/harness-survey.md`](research/harness-survey.md) synthesises them;
[`research/round2/README.md`](research/round2/README.md) synthesises the on-device round. This page
is the short version: the rules Goliath follows, where each comes from, and where it lives in
the code.

The [extension API](extensions.md) configures Goliath across a turn through typed lifecycle hooks.
The [research and original proposal](research/lifecycle-extensions.md) compares Claude Code, Grok
Bot, Mastra, Eve, Deep Agents, and Hermes and explains the design.

| Brief                                                                                  | What it settles                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`research/apple-foundation-models.md`](research/apple-foundation-models.md)           | The runtime: 4,096-token window shared by input and output (8,192 on newer iOS 27 devices), ~70 tokens per tool definition, 3 to 5 tools max, one request in flight, overflow kills the session, guardrail and refusal errors are not retryable                 |
| [`research/rn-providers-and-ai-sdk.md`](research/rn-providers-and-ai-sdk.md)           | The bridge: `@react-native-ai/apple` pre-registers tools and runs Apple's loop inside one call, so `stopWhen` never fires and tool calls come back with empty ids; guided generation is real constrained decoding; the AI SDK v7 accepts V3 providers unchanged |
| [`research/small-context-agent-patterns.md`](research/small-context-agent-patterns.md) | The harness: orchestrator sees summaries only, workers are stateless and narrow, small models fail multi-turn tool chains (8 to 56% vs 80%+ single-turn), never mix schema-constrained output with tool calls, escalate on structural signals                   |

## Rules Goliath follows

| Rule                                                                                                           | Why                                                                                                                    | Where                                                        |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| The conductor sees the ask, the memory brief, and one line per step. Never a tool result.                      | Anthropic's context-engineering guidance; Cognition's "one main loop carries state"                                    | `prompts.ts` `conductorUser`, `run-turn.ts`                  |
| One flat three-field plan per step: `kind`, `tool`, `brief`                                                    | Small models fill flat schemas reliably; Apple's guided generation accepts this subset                                 | `conductor.ts` `planSchema`                                  |
| A worker gets one tool and a fresh context, and returns only the arguments                                     | 1 to 3B models score 8 to 56% on multi-turn tool chains; Apple's provider gives no step boundary anyway                | `worker.ts` `runToolStep`                                    |
| Goliath never hands tools to the provider. It asks for arguments as structured output and runs the tool itself | Apple executes pre-registered tools inside its own session; mixing constrained output with tools suppresses tool calls | `worker.ts`, `tools/define-tool.ts`                          |
| A tool with no parameters skips the model call                                                                 | Apple: "run the tool directly before you call the model"                                                               | `worker.ts` `needsArguments`                                 |
| Tool results become `key: value` lines, capped at 600 characters                                               | Pre-formatted strings over raw JSON; tool-result clearing alone gave 29% in Anthropic's tests                          | `compress/structural.ts`                                     |
| Past 70% of the window, older step results clip to one line                                                    | MemGPT's 70% warning; Apple's overflow error kills the session                                                         | `conductor.ts` `PROMPT_SHARE`, `trimSteps`                   |
| Writes ask first                                                                                               | Every agent SDK has a per-tool approval hook; on a phone the user is right there                                       | `worker.ts`, `types.ts` `Confirm`                            |
| A malformed plan or argument object gets one retry; two in a row escalates                                     | Structural stall signals only                                                                                          | `run-turn.ts` `planRetried`, `NoObjectGeneratedError` checks |
| A repeated identical tool call, an empty answer, or the step cap escalates                                     | Same                                                                                                                   | `judge.ts`                                                   |
| Guardrail, refusal, overflow, and unavailable-model errors escalate as `model-error` and are never retried     | Apple documents them as non-retryable                                                                                  | `run-turn.ts` catch                                          |
| The fallback receives the ask, the brief, and the step log, never a transcript                                 | Escalation carries the summary; the cloud starts where the phone stopped                                               | `types.ts` `FallbackRequest`, `fallback/http-fallback.ts`    |
| The last three exchanges stay verbatim; an evicted one folds into a brief with fixed slots                     | Rolling summaries with recall-first prompts; decisions must travel, not just facts                                     | `scribe.ts`, `prompts.ts` `scribeSystem`                     |
| Token counts are chars/4 with a 15% margin until the provider exposes `countTokens`                            | Apple's tokenizer is private; the provider reports zero usage; chars/4 is within 10 to 20% on English                  | `budget.ts`                                                  |
| Every fixture names the ask, the expected tool calls, and where the turn should finish                         | τ-bench style end-state checks; the phone-vs-cloud split is the number that matters                                    | `evals/`                                                     |

### Rules borrowed from the harness survey

| Rule                                                                                      | Why                                                                                            | Where                                     |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------- |
| An empty answer gets one nudged retry, then escalates                                     | eve, OpenClaw, Hermes, Grok Bot all reissue once; none retry the same prompt twice             | `run-turn.ts` `EMPTY_ANSWER_NUDGE`        |
| A declined write carries the user's reason, worded as a decision the model must not retry | deepagents and Claude Code rejection text; Mastra `declineToolCall`                            | `worker.ts`, `types.ts` `ConfirmDecision` |
| A rejected plan is retried with the reason and the tool list                              | Claude Code feeds the validation error back; Hermes lists errors without re-pasting the schema | `conductor.ts` hints                      |
| A first identical read is served from the earlier result; the second is a loop            | Claude Code's stub for an unchanged re-read                                                    | `run-turn.ts` `findRepeatOfReadOnly`      |
| Three consecutive dead turns send the session to the cloud                                | Claude Code switches models after three overloads                                              | `create-agent.ts` `sessionFallback`       |
| Tools may shape their own model-facing output                                             | eve and Mastra `toModelOutput`                                                                 | `types.ts` `toModelOutput`                |
| The brief updates in place, has a Pending slot, and never lists finished work as pending  | eve checkpoint prompt, OpenClaw safeguard headings, Hermes iterative update                    | `prompts.ts` `scribeSystem`               |
| The conductor sees the step budget and a finish hint at 80%                               | Hermes's wrap-up notice                                                                        | `prompts.ts` `stepsLeft`                  |
| Workers never use placeholders or guess a value                                           | deepagents' Haiku profile                                                                      | `prompts.ts` `workerSystem`               |

### Rules borrowed from the on-device round

| Rule                                                                                         | Why                                                                                                                     | Where                                         |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| The plan opens with a one-sentence `why` before the decision                                 | A rationale before the answer is worth ~10 points at sub-3B under constrained decoding; field order is generation order | `conductor.ts` `WHY`                          |
| Tool names are an enum in the plan schema                                                    | Apple's no-hallucinated-name guarantee holds only for names in the schema                                               | `conductor.ts` `planSchemaFor`                |
| The ask is the last thing the conductor reads                                                | Small models are recency-biased                                                                                         | `prompts.ts` `conductorUser`                  |
| Tools declare `requires`; always-needed values arrive as `facts`, not tool steps             | TinyAgent's prerequisite lines; TN3193                                                                                  | `prompts.ts` `prerequisiteRules`, `factLines` |
| Workers name a missing value instead of inventing it                                         | "Wrong but valid" outputs are invented values                                                                           | `worker.ts` `withMissing`                     |
| A tool that throws is a result; two in a row escalate                                        | smolagents' error feedback                                                                                              | `worker.ts`, `judge.ts`                       |
| No fallback still gets a best-effort answer                                                  | smolagents' `provide_final_answer`                                                                                      | `run-turn.ts` `bestEffortAnswer`              |
| The step log is data, not instructions                                                       | Spotlighting; one in four injections lands on Apple's model                                                             | `prompts.ts` `conductorUser`                  |
| A guardrail hit stops on device                                                              | Escalating ships the flagged text; most hits on tool output are false positives                                         | `run-turn.ts` `isGuardrail`                   |
| Fixtures say whether escalation is forbidden, allowed, or expected; the runner scores pass^k | τ2-bench reward basis; τ-bench pass^k                                                                                   | `evals/`                                      |

## Open questions to settle on a device

1. How well Apple's guided generation fills a tool's argument schema from a one-line brief, versus its native tool prompt. Run the evals both ways.
2. How long a confirm can keep the user waiting before Apple's session times out. Goliath confirms outside the model call, so this should not bite, but measure it.
3. Whether the Callstack provider's `main` branch (context-overflow error code, `countTokens`) ships before Goliath needs it. Until then the published 0.12.0 reports every error as a plain string.
