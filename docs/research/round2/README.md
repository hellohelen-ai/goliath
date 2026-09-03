# Round two: what was built for small on-device models

Round one surveyed eight cloud harnesses. Round two, 2026-09-03, asked a narrower question: what
did people build specifically for 1 to 4B models on phones, and what do the papers say about
prompting them? Five briefs, each claim sourced.

| Brief                                                  | What it settles                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`on-device-planners.md`](on-device-planners.md)       | TinyAgent, LLMCompiler, Octopus, Apple's own guidance, and the 2025-26 small-model planning papers. Fine-tuning is the load-bearing ingredient in every strong small planner, and Goliath cannot fine-tune. Un-tuned 1 to 3B planners produce plans worse than no plan. Prompt, schema, and validator are the whole lever                    |
| [`on-device-agent-apps.md`](on-device-agent-apps.md)   | Private Mind has no agent loop. smolagents' prompts, error strings, and "answer anyway on max steps". Gemini Nano has no documented function calling; structured output only. Apple's App Intents let Siri call your app, not the reverse                                                                                                    |
| [`small-model-prompting.md`](small-model-prompting.md) | The strongest numbers of the round. A rationale field before the decision: +9.7 points at sub-3B. One to three examples: +21.5 pp at 3B, collapse at eight. Small models are recency-biased; the ask goes last. Greedy always; no same-model verify pass; validators beat sampling                                                           |
| [`eval-and-safety.md`](eval-and-safety.md)             | Greedy output is stable only per model build; three builds are live. τ2-bench's reward basis and pass^k. Small models are not more injectable, but one in four injections lands on Apple's model. Guardrail hits on tool output are usually false positives. App Review rejects apps that send data to a third-party model without naming it |
| [`on-device-memory.md`](on-device-memory.md)           | On a 3B model, injected context that is not needed destroys correct answers about half the time. Memory must be gated, not ranked. Apple's `NLContextualEmbedding` costs 20 to 35 ms and nothing to ship. Brute-force cosine is enough at assistant scale. A line grammar with a NONE sentinel is what a 3B writer can produce               |

## What changed in Goliath

| Change                                                                                                             | From                                                                    | Where                                         |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | --------------------------------------------- |
| The plan schema opens with an optional one-sentence `why`; field order is generation order under guided generation | Constraint Tax (+9.7 pts), JSONSchemaBench, Apple's property-order rule | `conductor.ts` `WHY`                          |
| Tool names are an enum in the plan schema; the invalid-plan hint names them                                        | Apple's guarantee holds only for names in the schema; PA-Tool           | `conductor.ts` `planSchemaFor`                |
| The ask is the last thing the conductor reads                                                                      | Recency bias at 7B; Anthropic's query-at-end                            | `prompts.ts` `conductorUser`                  |
| Tools declare `requires`; the conductor reads "Use X before Y."                                                    | TinyAgent's prerequisite lines                                          | `types.ts`, `prompts.ts` `prerequisiteRules`  |
| `facts` inject always-needed values as `key: value` lines instead of tool steps                                    | TN3193: run the tool before the model                                   | `create-goliath.ts`, `prompts.ts` `factLines` |
| `examples` show two or three worked plans, optional, to be measured                                                | Meta-Tool +21.5 pp; the 8-shot collapse                                 | `prompts.ts` `exampleLines`                   |
| Workers get a trailing `missing` field and name a value they lack instead of inventing it                          | Constraint Tax's "wrong but valid" outputs are invented values          | `worker.ts` `withMissing`                     |
| The conductor is told never to repeat a call with the same arguments                                               | smolagents rule 4                                                       | `prompts.ts` `conductorSystem`                |
| A tool that throws is a step result the conductor plans around; two in a row escalate                              | smolagents' error feedback                                              | `worker.ts`, `judge.ts` `judgeToolFailures`   |
| With no fallback, a stalled loop answers from the step log, marked `bestEffort`                                    | smolagents' `provide_final_answer`                                      | `run-turn.ts` `bestEffortAnswer`              |
| The step log is framed as data that may be wrong and must not be obeyed                                            | Microsoft spotlighting; deepagents' memory guideline                    | `prompts.ts` `conductorUser`                  |
| A guardrail hit stops on device and never calls the fallback                                                       | Escalating would ship the flagged text; false positives are common      | `run-turn.ts` `isGuardrail`                   |
| Fixtures declare `escalation: forbidden \| allowed \| expected` and `forbids`; the runner scores pass^k            | τ2-bench reward basis; τ-bench pass^k                                   | `evals/`                                      |
| Long results show a head, an omitted count, and a tail; error lines survive                                        | deepagents, Grok Bot, OpenClaw                                          | `compress/structural.ts`                      |

## Considered and rejected

- **A one-shot DAG plan for simple asks.** LLMCompiler's speedups are parallel-execution speedups and Apple serializes. TinyAgent's 80% needed 80k fine-tuning examples. Un-tuned 1 to 4B planners hit 22 to 26% DAG exact match on hard tasks. Step-at-a-time with a `why` field stays. Revisit only with an eval set that shows a band of asks where one shot wins.
- **Best-of-N and same-model verify passes.** Best-of-32 with a 14B reward model gave +2.2 points; majority vote at N=2 is undefined; self-correction without an external verifier is negative below 13B. Greedy plus deterministic validators plus one retry.
- **Functional tokens (Octopus).** Needs tokenizer surgery. The enum of tool names captures the "cannot hallucinate a name" property without the 95% context saving.
- **LLM injection detectors and approval classifiers.** A second call on the only slot, and a 3B judge is weak. Router narrowing, spotlighting, read-only classification, and the confirm sheet instead.
- **Model-version pinning for reproducible evals.** It does not exist. Recordings are keyed by OS build and context size; a run on a new key is a baseline, not a regression.

## Still on the list, ordered by what it buys

1. **Memory v2.** Pinned profile slots (≤600 chars), a fact store with `observedAt`/`invalidatedAt`, Apple embeddings with model identity per vector, brute-force cosine behind an adapter, a similarity floor before any fact is injected, extraction only at scribe boundaries with a line grammar and a NONE sentinel. The full shape is in `on-device-memory.md`.
2. **Redaction projection on escalation.** Replace names, emails, numbers, and ids with consistent placeholders held in a local map; rehydrate on return; show the user what is sent. PlanTwin, on-device PII substitution.
3. **Confirm contract.** Decisions as `allow-once | deny` (no allow-always for writes in v1); fingerprint of tool plus canonical arguments; a reshaped call is a new confirm; one pending confirm at a time. Mastra, Grok Bot, OWASP ASI01.
4. **Consent gate before the first cloud call.** Names the provider, the data types, the purpose, and when fallback triggers. App Review guideline 5.1.2(i).
5. **PCC as the first cloud tier on Apple** when eligible and under quota, then eve. The `httpFallback` payload shape for eve is in round one's eve brief.
6. **Record and replay** stamped with OS build, context size, and executed model; `GOLIATH_SNAPSHOT=replay` in CI.
7. **A tool-renaming pass at definition time.** Verb names, one sentence stating when to pick the tool over its neighbours. PA-Tool: +17 pp at 3B.
8. **The examples A/B.** 0 vs 1 vs 3 worked plans on the eval set; keep the smallest count within a point of the best.
9. **Grow the fixtures to the category table** in `eval-and-safety.md`: irrelevant asks, missing parameters, injected tool results, guardrail false positives, escalation expected and forbidden.
10. **Runtime window.** Read `contextSize` when the provider exposes it (8,192 on iOS 27 devices) instead of assuming 4,096.
