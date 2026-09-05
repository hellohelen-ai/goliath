---
title: Introduction
description: What Goliath is, what it is for, and what it is not.
---

Goliath is an agent harness for small on-device language models. Its primary target is Apple
Foundation Models: a language model of roughly three billion parameters that ships on every iPhone
with Apple Intelligence. The model runs locally, at no cost, and no data leaves the device. It also
has a 4,096-token context window and loses track of a task after a few tool calls.

Goliath is designed around that constraint. It:

- plans **one step at a time**, as a small JSON object;
- runs each step in a **fresh context** with **one tool**;
- keeps every tool result **under 600 characters**;
- **confirms before it changes anything**;
- **hands the turn to a cloud agent** when the device cannot finish.

## Who it is for

Apps that want a personal assistant to run on the device by default. Task lists, notes, calendars,
messages: asks with two to five tools and an answer in a few sentences. When an ask is too big for
the phone, Goliath sends what it learned to your server and the cloud picks up from there.

## What it is not

- **Not a model.** Bring any [AI SDK](https://ai-sdk.dev) `LanguageModel`. On a phone that is
  [`@react-native-ai/apple`](https://ai-sdk.dev/providers/community-providers/react-native-apple).
- **Not a chat UI.** `run(ask)` returns text, the step log, and who handled it. Render it how you like.
- **Not a long-context agent.** If you have a 200k window, use the AI SDK's own loop. Goliath exists
  for the 4k case.

## Where to go next

- [Installation](/goliath/start/installation/)
- [Your first turn](/goliath/start/first-turn/)
- [How a turn runs](/goliath/guides/how-a-turn-runs/)
