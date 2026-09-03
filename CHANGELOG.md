# Changelog

All notable changes to this project are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the version is below
`1.0.0`, a minor bump may carry a breaking change; the entry will say so.

## [Unreleased]

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

[unreleased]: https://github.com/hellohelen-ai/goliath/compare/v0.0.2...HEAD
[0.0.2]: https://github.com/hellohelen-ai/goliath/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/hellohelen-ai/goliath/releases/tag/v0.0.1
