---
title: Contributing
description: Setup, what a good change looks like, and how releases are cut.
---

The full guide is
[`CONTRIBUTING.md`](https://github.com/hellohelen-ai/goliath/blob/main/CONTRIBUTING.md) in the
repository. The short version:

## Setup

```sh
bun install
bun run check   # typecheck, format check, tests, build
```

`bun run check` is exactly what CI runs.

## A good change

- **Tests come with it.** Every behaviour in `src/` has a test in `tests/`, scripted with `fakeModel`.
- **Prompt changes are tested as prompts.** Assert on what the conductor and worker actually read.
- **Token cost is part of the diff.** Say what a new prompt line costs and why it is worth it.
- **No new runtime dependencies.** A dependency is a download on someone's phone.

## Pull requests

Open against `main`. CI has to be green. If the change is user-visible, add an entry under
`## [Unreleased]` in `CHANGELOG.md` in the same PR.

## This site

The docs live in `website/` and are built with [Starlight](https://starlight.astro.build). They
are not part of the published package or the example app.

```sh
cd website
bun install
bun run dev
```

Every page has an "Edit page" link that opens the source on GitHub.

## Security

Report security issues
[privately](https://github.com/hellohelen-ai/goliath/blob/main/SECURITY.md), not as a public
issue.
