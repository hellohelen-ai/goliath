# Changelog

All notable changes to this project are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the version is below
`1.0.0`, a minor bump may carry a breaking change; the entry will say so.

## [Unreleased]

### Fixed

- Classify native unsafe-content refusals, including wrapped errors, as guardrails without
  retrying or sending them to fallback; recognize native Generable decode failures in the
  existing bounded structured-output validation paths.
- Retain nonempty best-effort replies and tool evidence in conversation memory, marked partial
  in subsequent prompts and memory compaction.
- Show cause-specific unfinished outcomes in the example, including refusal, repeated-step,
  model, and validation failures; avoid success icons and misleading smaller-request advice.

### Added

- Standalone interactive `docs/harness-walkthrough.html` explaining the base harness, model/code
  boundaries, lifecycle hooks, token budgets, storage, and screenshot failure paths.
- Scripted provider errors via `fakeModel([{ error: new Error(...) }])` for recovery regression tests.

- Optional `@hellohelen-ai/goliath/filesystem` module with in-memory, static, SQLite, and composite
  backends; scoped backend factories; bounded glob/grep/read tools; and revision-checked writes.
- Token-budgeted literal tool output via `outputMode: "content"`, configurable per-result and
  active retrieval limits, and explicit approval requirements for opted-in writing tools.
- Example file tools with read-only sample documents, persistent shared notes, conversation-local
  scratch space, approval cards, and file suggestions; filesystem guide and API reference.

- Conversation-aware `agent.run(text, { conversationId })`, with isolated memory, request queues,
  context-window tracking, and fallback counts; existing calls use a separate default conversation.
- Memory factories for persistent history per conversation, per-run approval callbacks, and
  `isSessionFallback(conversationId)`; hooks and tools receive conversation IDs outside prompts.
- Local SQLite persistence in the example: conversations, drafts, transcripts, approval decisions,
  and compacted agent memory survive restarts, with interrupted requests marked for explicit retry.

### Changed

- Example task completion selects an ID from `listTasks` instead of matching titles; reject
  unlisted IDs before approval and expose IDs alongside titles in model-facing lookup results.
- The example exports one shared agent from `agent.ts`; Goliath manages conversation sessions
  while Zustand holds UI state and the runtime adapter handles approval buttons and cancellation.

## [0.2.0] - 2026-09-07

### Added

- Optional `outputSchema` on `createAgent` or individual `run` calls for guided structured
  device answers with inferred `RunResult<T>.output`, schema-aware input budgeting, and one
  validation retry. Cloud fallback and extension stops remain text-only.
- A dark conversation UI for the example, with an inbox, search, suggested requests, inline
  task confirmations, and per-conversation agent memory.
- Console lifecycle logging in the example app, with Fast Refresh for the local harness source
  and development client support for iOS simulators and devices.
- Example UI split into hooks and focused screen components, with mock-tool suggestions and
  the shared docs stone logo.
- Zustand state for example conversations, drafts, navigation, and search, with coverage for
  background replies, concurrent sends, and conversation filtering.

### Changed

- Separated example agent execution from conversation state, with `ask`/`approve`/`cancel` in
  an independent runtime and a small conversation hook connecting results and approvals to Zustand.
- Organized the example agent under `src/agents/goliath/`, with separate configuration, React
  integration, lifecycle logging, and task tools split into individual modules with shared mock data.

## [0.1.0] - 2026-09-05

This release contains a breaking rename; see **Changed**.

### Added

- Typed lifecycle extensions with ordered async hooks for run start, recall, planning, tools,
  fallback, answers, memory, errors, and finalization. Includes per-run application context,
  private extension state, tool denial, explicit stops, and extension error diagnostics.
- Optional `countTokens` and async `window` callbacks, plus model factories for fresh generation
  contexts. Budget events identify native/provider counts versus estimates.
- A local Expo module for Apple context capacity and iOS 26.4+ token counting. The example and
  its CI checks now use the local library build.
- `resolveInput` for deterministic reference-to-ID handoffs, validated before confirmation.
  Full JSON-serializable tool outputs are retained in recent exchange records for application code.
- Per-call context checks and budget trace events for planning, argument generation, answers,
  and memory. Requests that still cannot fit escalate as `context-budget` before generation,
  or reject with `GoliathBudgetError` when lifecycle extensions are configured.
- An example Expo app in `example/`, typechecked in CI so it cannot drift from the public API. It
  is not part of the published package.

### Changed

- **Breaking.** `createGoliath` is renamed to `createAgent`, and the returned `Goliath` type is
  renamed to `Agent`. The configuration object and its options are unchanged.
- Cap output tokens at every stage and include structured-output schemas and provider headroom
  in input budgeting. Disable automatic SDK retries; the harness still retries invalid plans
  and empty answers once.
- Apply the 600-character tool-result cap to custom `toModelOutput` formatters too. Applications
  that previously returned longer strings should filter or paginate their results.
- Estimate non-ASCII text conservatively and clip memory with the same estimator.

### Fixed

- Generated tool arguments reuse the AI SDK's validated output so schema transformations run
  once; no-argument calls and extension-provided replacements still receive validation.
- Application and extension errors no longer trigger model-error fallback; fallback failures
  reject without a second handoff attempt.
- Session fallback now emits a complete trace and saves memory through the shared lifecycle.
  Model-error fallback retains the previous summary and the latest three exchanges without
  calling the failed device again; older exchanges are dropped on that route.
- Cloud answers emit answer events, and saved summary limits include the token estimator's margin.
- Recent exchanges now reach device prompts, including their completed/skipped action records.
- Duplicate writes are blocked before confirmation and execution. Object key order and argument
  mutation cannot evade the check. Read caches are invalidated after writes, and declared tool
  prerequisites must have succeeded before execution.
- Serialize turns on each instance. Failed memory saves and result formatters cannot erase a
  completed action, and failed fallback calls are no longer invoked twice.
- Planner compaction can no longer send a prompt that remains over budget. Final answers,
  including best-effort answers, also compact older step results when needed.
- Failed memory generation no longer replaces a completed answer with fallback. Preserve the
  previous brief and latest exchanges, emit `memory-error`, and avoid reusing a failed device
  session to summarize a cloud answer.

### Deprecated

- The unused `compressors` option. Use `afterTool` and `beforePlan` extensions instead.

## [0.0.3] - 2026-09-03

### Changed

- Build with TypeScript 7. Emitted JavaScript is byte-identical to the 5.9.3 build; only
  declaration property order changes.

## [0.0.2] - 2026-09-03

No changes to the library. This is the first release published from CI, and it exists to prove
that path works end to end.

### Added

- `CHANGELOG.md` now ships inside the package.

### Changed

- Releases are published from GitHub Actions over OIDC trusted publishing and carry a provenance
  attestation. No npm token exists for this package. Verify with `npm audit signatures`.

## [0.0.1] - 2026-09-03

First release.

### Added

- `createGoliath` — the turn loop: recall, conduct, work, judge, answer, remember.
- Step-at-a-time planning with a JSON plan whose tool names are an enum, so constrained decoding
  cannot invent one.
- A worker that runs each step in a fresh context with one tool and a ≤600-character result.
- `defineTool`, with `writes: true` marking a tool that must be confirmed before it runs.
- Structural compression of tool results: a head, an omitted count, and a tail, with error lines
  kept through the cut.
- A token budget that drops the oldest non-system messages first and never drops the last one.
- Escalation to a cloud fallback on a stalled loop, a repeated call, an invalid plan, bad tool
  arguments, or three turns of model errors.
- A scribe that keeps recent exchanges verbatim and folds evicted ones into a running brief.
- Memory adapters: `inMemory` and `keyValueMemory`.
- `httpFallback` for handing a turn to a cloud agent.
- `@hellohelen-ai/goliath/testing` with `fakeModel`, a scripted model for tests.
- An eval runner scoring fixtures with `pass^k` over repeated runs, per-fixture escalation
  expectations, and forbidden words.

[unreleased]: https://github.com/hellohelen-ai/goliath/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/hellohelen-ai/goliath/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/hellohelen-ai/goliath/compare/v0.0.3...v0.1.0
[0.0.3]: https://github.com/hellohelen-ai/goliath/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/hellohelen-ai/goliath/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/hellohelen-ai/goliath/releases/tag/v0.0.1
