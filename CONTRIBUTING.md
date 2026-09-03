# Contributing

Thanks for looking. Goliath is small on purpose, and the constraint that shapes every decision is
the 4,096-token window on the phone's own model. A change that spends tokens has to earn them.

## Getting set up

The project uses [Bun](https://bun.sh).

```sh
bun install
bun run check   # typecheck, format check, tests, build
```

`bun run check` is exactly what CI runs and what `npm publish` runs before it packs. If it passes
locally it passes on the way out.

Individual pieces, when you want a faster loop:

```sh
bun test                  # tests
bun test tests/budget     # one file
bun run typecheck         # tsc --noEmit
bun run format            # prettier --write
bun run evals             # the eval fixtures
```

## What a good change looks like

- **Tests come with it.** Every behaviour in `src/` has a test in `tests/`, and the model is
  scripted with `fakeModel` rather than mocked ad hoc. A new rule in the loop is a new test.
- **Prompt changes are tested as prompts.** `tests/borrowed-rules.test.ts` asserts on what the
  conductor and worker actually read. If you change a prompt, assert the new shape.
- **Token cost is part of the diff.** Adding a field to a prompt or a line to a tool result takes
  budget from the step log. Say what it costs and why it is worth it.
- **No new runtime dependencies.** `ai` and `zod` are peer dependencies and the list ends there.
  A dependency is a download on someone's phone.

## Commits and PRs

Write the commit message for someone reading `git log` in a year: say what changed and why, not
which files moved. The body is the place for the reasoning.

Open the PR against `main`. CI has to be green. If the change is user-visible, add an entry under
`## [Unreleased]` in `CHANGELOG.md` in the same PR — that is what the release notes are built from.

## Releases

Maintainers only, and deliberately boring:

1. Move the `## [Unreleased]` entries in `CHANGELOG.md` under a new version heading.
2. Bump `version` in `package.json`.
3. Commit to `main`, then `git tag vX.Y.Z && git push origin vX.Y.Z`.

The tag triggers `.github/workflows/publish.yml`, which waits for a required reviewer to approve
the `release` environment before any step runs. It then refuses to continue if the tag and
`package.json` disagree, and publishes to npm over OIDC trusted publishing — there is no npm token
anywhere in the repo or in GitHub secrets, and every release carries a provenance attestation
linking it to the build that produced it.

Only repository admins can create a `v*` tag, and once pushed a tag cannot be moved or deleted,
because provenance points at a commit.

If the workflow filename or the environment ever changes, the npm trusted publisher has to be
re-pointed at the same values or the OIDC claim will not match:

```sh
npm trust list @hellohelen-ai/goliath
npm trust revoke @hellohelen-ai/goliath --id=<id>
npm trust github @hellohelen-ai/goliath \
  --file publish.yml --repository hellohelen-ai/goliath \
  --environment release --allow-publish
```
