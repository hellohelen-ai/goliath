---
title: Evals
description: Score any model against the asks a personal assistant hears every day.
---

The repository's `evals/fixtures.ts` holds asks with the tool calls a good run makes and where the
turn should finish. `runEvals` scores any model against them and prints the phone-versus-cloud
split.

```
PASS  list-today         device    412ms
PASS  add-task           device    655ms
PASS  add-after-check    device   1203ms
PASS  small-talk         device    198ms
PASS  plan-week          cloud     301ms

5/5 passed · 4 on device · 1 escalated
```

That last line is the number this project exists for.

## Running them

```sh
bun run evals
```

With no model on the machine, the CLI runs a scripted perfect model. That proves the runner and
shows the report shape. On a device, call `runEvals` from your app with a real model and
`runs: 3`.

## What a fixture says

| Field        | Meaning                                                          |
| ------------ | ---------------------------------------------------------------- |
| `ask`        | What the user said                                               |
| `tools`      | The tool calls a good run makes, in order                        |
| `handledBy`  | Where the turn should finish: `device` or `cloud`                |
| `escalation` | `forbidden`, `allowed`, or `expected`. Defaults from `handledBy` |
| `mentions`   | Words the answer must contain                                    |
| `forbids`    | Words the answer must not contain                                |

## pass^k

A fixture passes only when every one of `runs` passes. A personal assistant that is right two
times in three is not right. Mean steps per task is logged as an efficiency signal but never
fails a fixture.
