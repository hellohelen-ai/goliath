---
title: Research
description: The briefs behind the design, each claim with a source.
---

The research lives in the repository under
[`docs/research/`](https://github.com/hellohelen-ai/goliath/tree/main/docs/research). Every claim
in a brief carries a source. This page is the map.

## The platform

| Brief                                                                                                                                | What it settles                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Apple Foundation Models](https://github.com/hellohelen-ai/goliath/blob/main/docs/research/apple-foundation-models.md)               | The runtime: 4,096-token window shared by input and output (8,192 on newer iOS 27 devices), ~70 tokens per tool definition, 3 to 5 tools max, one request in flight, overflow kills the session, guardrail and refusal errors are not retryable                 |
| [React Native providers and the AI SDK](https://github.com/hellohelen-ai/goliath/blob/main/docs/research/rn-providers-and-ai-sdk.md) | The bridge: `@react-native-ai/apple` pre-registers tools and runs Apple's loop inside one call, so `stopWhen` never fires and tool calls come back with empty ids; guided generation is real constrained decoding; the AI SDK v7 accepts V3 providers unchanged |
| [Small-context agent patterns](https://github.com/hellohelen-ai/goliath/blob/main/docs/research/small-context-agent-patterns.md)     | The harness: orchestrator sees summaries only, workers are stateless and narrow, small models fail multi-turn tool chains (8 to 56% vs 80%+ single-turn), never mix schema-constrained output with tool calls, escalate on structural signals                   |

## Other harnesses

Eight briefs on other agent harnesses live in the
[helen repository](https://github.com/hellohelen-ai/helen/tree/main/docs/research/harnesses).
[`harness-survey.md`](https://github.com/hellohelen-ai/goliath/blob/main/docs/research/harness-survey.md)
synthesises them.

## The on-device round

Five briefs on what was built for small on-device models, synthesised in
[`round2/README.md`](https://github.com/hellohelen-ai/goliath/blob/main/docs/research/round2/README.md):

- [On-device planners](https://github.com/hellohelen-ai/goliath/blob/main/docs/research/round2/on-device-planners.md)
- [Small-model prompting](https://github.com/hellohelen-ai/goliath/blob/main/docs/research/round2/small-model-prompting.md)
- [On-device memory](https://github.com/hellohelen-ai/goliath/blob/main/docs/research/round2/on-device-memory.md)
- [On-device agent apps](https://github.com/hellohelen-ai/goliath/blob/main/docs/research/round2/on-device-agent-apps.md)
- [Eval and safety](https://github.com/hellohelen-ai/goliath/blob/main/docs/research/round2/eval-and-safety.md)

[Rules Goliath follows](/goliath/design/rules/) maps each rule back to one of these.
