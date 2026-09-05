# Changelog

All notable changes to this project are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the version is below
`1.0.0`, a minor bump may carry a breaking change; the entry will say so.

## [Unreleased]

### Added

- Typed lifecycle extensions with ordered async hooks for run start, recall, planning, tools,
  fallback, answers, memory, errors, and finalization. Includes per-run application context,
  private extension state, tool denial, explicit stops, and extension error diagnostics.
- Prompt budget checks when extensions are configured, covering every device model phase;
  transformed tool results are bounded before entering the transcript.
- An example Expo app in `example/`, typechecked in CI so it cannot drift from the public API. It
  is not part of the published package.

### Fixed

- Generated tool arguments reuse the AI SDK's validated output so schema transformations run
  once; no-argument calls and extension-provided replacements still receive validation.
- Check repeated tool calls before execution so a duplicate write cannot execute twice. Failed
  and skipped reads are no longer reused as cached successes.
- Application and extension errors no longer trigger model-error fallback; fallback failures
  reject without a second handoff attempt.
- Session fallback now emits a complete trace and saves memory through the shared lifecycle.
  Model-error fallback retains the previous summary and the latest three exchanges without
  calling the failed device again; older exchanges are dropped on that route.
- Cloud answers emit answer events, and saved summary limits include the token estimator's margin.

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

[unreleased]: https://github.com/hellohelen-ai/goliath/compare/v0.0.3...HEAD
[0.0.3]: https://github.com/hellohelen-ai/goliath/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/hellohelen-ai/goliath/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/hellohelen-ai/goliath/releases/tag/v0.0.1
