# Harness survey: what eight agent harnesses taught Goliath

Eight briefs live in the helen repo under [`docs/research/harnesses/`](https://github.com/hellohelen-ai/helen/tree/main/docs/research/harnesses), researched 2026-09-02 from DeepWiki, each project's docs, and
its source. Every claim in a brief carries a URL. This page is the synthesis: what the harnesses
agree on, what Goliath changed because of it, and what is still on the list.

| Harness          | Brief                                                                                                                           | What it is                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code      | [`harnesses/claude-code.md`](https://github.com/hellohelen-ai/helen/blob/main/docs/research/harnesses/claude-code.md)           | Anthropic's terminal coding agent: one query loop, ~40 tools, three tiers of compaction, permission modes, hooks, subagents                                         |
| Grok Bot 0.18    | [`harnesses/grok-bot.md`](https://github.com/hellohelen-ai/helen/blob/main/docs/research/harnesses/grok-bot.md)                 | Cursor's desktop agent runtime reconstructed from the shipped bundle: 5,000-step turns, lenient argument repair, LLM safety classifier, refusal memory              |
| Hermes           | [`harnesses/hermes.md`](https://github.com/hellohelen-ai/helen/blob/main/docs/research/harnesses/hermes.md)                     | Nous Research's self-improving agent: 70+ tools, 13-section handoff summary, skills that write themselves, and a maintainer position against local-to-cloud routing |
| OpenClaw         | [`harnesses/openclaw.md`](https://github.com/hellohelen-ai/helen/blob/main/docs/research/harnesses/openclaw.md)                 | A messaging-first gateway with a compaction safeguard that audits summaries for lost identifiers and unanswered asks                                                |
| DeepSeek harness | [`harnesses/deepseek-harness.md`](https://github.com/hellohelen-ai/helen/blob/main/docs/research/harnesses/deepseek-harness.md) | Everything-is-a-plugin harness whose model context is derived from an append-only log; Ralph, a fresh-context worker loop with a structured handoff                 |
| deepagents       | [`harnesses/deepagents.md`](https://github.com/hellohelen-ai/helen/blob/main/docs/research/harnesses/deepagents.md)             | LangChain's harness: middleware stack, virtual filesystem as offload target, isolated subagents, four-decision human-in-the-loop                                    |
| eve              | [`harnesses/eve.md`](https://github.com/hellohelen-ai/helen/blob/main/docs/research/harnesses/eve.md)                           | Vercel's durable backend agent framework, and the cloud side of Helen: one model call per step, two-tier compaction, an HTTP session protocol Goliath can call      |
| Mastra           | [`harnesses/mastra.md`](https://github.com/hellohelen-ai/helen/blob/main/docs/research/harnesses/mastra.md)                     | TypeScript agent framework with memory processors, a fixed-slot working-memory template, and observational memory                                                   |

## What they agree on

Every harness on the list runs a frontier model with a 100k-plus window. Their numbers do not
transfer: Claude Code's compaction _buffer_ is three times Goliath's whole window. Their shapes do,
and five of them recur in almost every brief.

1. **Summaries have fixed slots and update in place.** eve's checkpoint prompt, OpenClaw's five
   mandatory headings, Hermes's thirteen-section handoff, DeepSeek's "(none) for an empty
   section, never drop a section", Mastra's working-memory template. All of them tell the model
   to keep finished work out of the pending list and to keep exact identifiers.
2. **An empty answer gets one nudge, then it is a failure.** eve's `EMPTY_RESPONSE_NUDGE`,
   OpenClaw's incomplete-turn recovery, Hermes's empty-tool-response nudge, Grok Bot's
   continuation injector, Mastra's zero-output step error. Nobody retries the same prompt twice.
3. **Errors are results the model reads, not exceptions.** Malformed arguments, unknown tools,
   declined approvals, and timeouts all come back as text in the tool slot, worded so the model
   knows what to do next. Claude Code and deepagents both say a decline must state the write did
   NOT happen and must not be retried.
4. **Clear tool results deterministically before you pay for a summary.** eve's 2,000-char cap
   before the model call, Claude Code's microcompact, Hermes's one-line pruning, OpenClaw's
   soft-trim and hard-clear. The model summarises only what the cheap pass could not remove.
5. **Never split a call from its result, and never end on the assistant.** Every compaction
   walks the cut point back to a turn boundary; eve appends "Continue." if the history would end
   on the model.

Three more are specific to the cloud but shaped Goliath's escalation path: Hermes escalates per
turn and starts the next one on the primary model; Claude Code switches models after three
consecutive overloads; Grok Bot remembers a refusal for the rest of the task and never re-asks.

## What changed in Goliath

| Change                                                                                                                  | Borrowed from                                                                | Where                                     |
| ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------- |
| One nudged retry before an empty answer escalates                                                                       | eve, OpenClaw, Hermes, Grok Bot, Mastra                                      | `run-turn.ts` `EMPTY_ANSWER_NUDGE`        |
| A declined write carries the user's reason, worded as a decision: "declined by the user: …. Do not retry unless asked." | deepagents, Mastra, Claude Code, Grok Bot                                    | `worker.ts`, `types.ts` `ConfirmDecision` |
| A rejected plan is retried with the reason: bad JSON, or "No such tool available: X. Pick one of: …"                    | Claude Code, Hermes, Mastra                                                  | `conductor.ts` hints                      |
| A first identical call of a no-argument read-only tool is served from the earlier result; the second is a loop          | Claude Code's stub for an unchanged re-read; DeepSeek's canonical repeat key | `run-turn.ts` `findRepeatOfReadOnly`      |
| After three consecutive turns die on the device, the session goes straight to the cloud                                 | Claude Code's `MAX_529_RETRIES`                                              | `create-agent.ts` `sessionFallback`       |
| Tools may declare `toModelOutput` to shape what the model sees while the app keeps the full result                      | eve, Mastra                                                                  | `types.ts`, `worker.ts`                   |
| The scribe updates the brief rather than re-summarising, has a `Pending` slot, and never lists finished work as pending | eve, OpenClaw, Hermes, DeepSeek                                              | `prompts.ts` `scribeSystem`               |
| The conductor sees "Step k of N" and "finish now" at 80%                                                                | Hermes's run-budget wrap-up notice                                           | `prompts.ts` `stepsLeft`                  |
| Workers are told never to use placeholders or guess a value                                                             | deepagents' Haiku profile                                                    | `prompts.ts` `workerSystem`               |
| The brief is framed as reference only; act on the ask                                                                   | Hermes's `SUMMARY_PREFIX`, DeepSeek's checkpoint preamble                    | `prompts.ts` `conductorUser`              |
| An empty tool output reads "(no output)"                                                                                | DeepSeek, Claude Code                                                        | `compress/structural.ts`                  |
| Evals report mean steps per task as a soft metric that never fails                                                      | deepagents' two-tier evals                                                   | `evals/run-evals.ts`                      |
| Tools are keyed by their own name whatever the app called the property                                                  | (a bug the Mastra test found)                                                | `create-agent.ts`                         |

Already in place before the survey and confirmed by it: one flat step per model call, one tool
per fresh-context worker, arguments as structured output, `key: value` results capped at 600
characters, writes confirm first, the step log as the escalation payload.

## Considered and rejected for a 4k window

- **Percentage thresholds** (compact at 85 to 90%, keep 10 to 16%). At 4,096 tokens the "keep"
  slice is smaller than one tool description. Goliath compacts every step by construction.
- **Summaries written by the same model over the whole transcript.** The transcript does not
  fit. The scribe folds one evicted exchange at a time into fixed slots.
- **Parallel tool calls, background subagents, background summarisers.** Apple's runtime allows
  one request in flight. Workers are a relay, not a swarm.
- **LLM safety classifiers and LLM judges in the live loop.** A second call per tool doubles
  latency on the only slot, and a 3B judge is weak. Static rules and the confirm sheet instead.
- **Tool search, code mode, virtual filesystems the model pages through.** They exist to fit big
  catalogs into big prompts. The conductor sees names and one-line descriptions; the worker sees
  one schema; Goliath does the paging.
- **Exponential backoff with minutes of retries.** On-device errors are deterministic. One retry
  where the model was at fault, escalate otherwise.
- **Hermes's position.** Its maintainers reject progress-based local-to-cloud routing as a
  design direction. Goliath is that design; the Hermes thread supplies the arguments to answer,
  not code to copy. The admission-control split it proposes (should the local model get another
  turn, versus where to send it) is the shape of Goliath's judge and fallback.

## Still on the list

Sourced in the briefs, not yet in code. Ordered by how much each buys on a phone.

1. **Head plus tail with an error tail** for long results: first lines, "N omitted", last lines,
   and any line matching `error|failed` kept. deepagents' preview shape, OpenClaw's diagnostic
   tail, Grok Bot's front-and-back truncation.
2. **Persisted results with a locator.** Store the full result under `r<step>`, show a preview,
   let the cloud fallback resolve the id. Claude Code, DeepSeek's spill policy, Grok Bot's
   agent-tools file.
3. **Lenient coercion before calling arguments invalid.** `"true"` to `true`, numeric strings,
   case-insensitive enums, scalar to single-item array. Grok Bot's lenient schemas, Mastra's
   six-stage pipeline.
4. **Confirm decisions as an enum with a durable allow-always.** `allow-once | allow-always |
deny`, an allowlist keyed by tool and argument pattern, and a refusal memory so the same
   write is never re-asked in one task. Hermes, OpenClaw, Grok Bot, eve's `once()`.
5. **A brief audit with one corrective retry.** Every identifier in the last results must survive
   into the brief; the latest ask must appear in Goal or Pending. OpenClaw's
   `auditSummaryQuality`.
6. **Hooks.** `beforeTool` (block, rewrite arguments, add context), `afterTool`, `beforeBrief`,
   `onEscalate`, in-process, with a per-hook timeout. Claude Code, OpenClaw, DeepSeek, deepagents.
7. **Record and replay.** Record on-device outputs per step to JSONL on a Mac, replay in CI with
   no device. DeepSeek's session snapshots, eve's `mockModel`.
8. **The eve endpoint.** The `httpFallback` payload shape that lets Helen's existing
   `/eve/v1/session` accept a Goliath turn with the brief and step log as `clientContext` and a
   structured `outputSchema` for the reply. Specified in the eve brief, section 11.
9. **Memory extraction as lines, not JSON.** `profile:` / `log:` / `note:` / `remove:` or `NONE`,
   skipped for trivial exchanges. Grok Bot's extractor; friendlier to a 3B model than a schema.
10. **Idle-gap reset.** Resume after an hour starts from the brief alone. Claude Code's
    time-based clearing, Hermes's freshness window.
