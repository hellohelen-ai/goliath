## What this changes

<!-- What behaviour is different afterwards, and why. -->

## Token cost

<!--
Does this add to a prompt, a plan, or a tool result? Goliath runs in a 4,096-token window, so
say what this spends and what it buys. "None" is a perfectly good answer.
-->

## Checklist

- [ ] `bun run check` passes
- [ ] Tests cover the new behaviour (scripted with `fakeModel`, not mocked ad hoc)
- [ ] Prompt changes are asserted as prompts
- [ ] `CHANGELOG.md` has an entry under `## [Unreleased]`, if this is user-visible
- [ ] No new runtime dependencies
