---
title: Why not a plain loop
description: What goes wrong when you call a 3B model in a tool loop on a phone.
---

You can. The AI SDK's `generateText` with `stopWhen` is that loop, and Apple's own session runs a
tool loop natively. Both fall over on a phone for the same reasons.

## The window fills

One JSON tool result can be a thousand tokens. Three of them and the model has forgotten the ask.
Goliath keeps every result under 600 characters and never shows the conductor raw JSON.

## Many tools confuse a small model

Past about five definitions, it picks wrong or invents arguments. Goliath gives each worker one
tool, and the conductor picks from an enum.

## Apple runs its loop out of sight

Under the Callstack provider, tools are pre-registered and executed inside Apple's own session.
The AI SDK sees one step; `stopWhen` never fires; tool calls come back with empty ids. Goliath
never hands tools to the provider. It asks for the arguments as structured output, which Apple's
guided generation constrains at decode time, then runs the tool itself.

## There is no confidence signal

No logprobs on device. Goliath watches for the things a lost 3B model does: repeats itself,
answers with nothing, runs past the cap.

## Small models fail multi-turn chains

Models of one to three billion parameters score 8 to 56 percent on multi-turn tool chains against
80 percent or better single-turn. So every worker step is single-turn.

Each of these has a source. See [Research](/goliath/design/research/).
