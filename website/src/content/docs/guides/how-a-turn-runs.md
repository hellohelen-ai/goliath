---
title: How a turn runs
description: The stages of one Goliath turn and what each one sees.
---

```
ask ──► recall ──► conductor ──► worker ──► judge ──► … ──► answer ──► remember
            │          │            │          │
         memory    next step    fresh ctx   stalled?
         brief     (JSON, 3     one tool    → fallback
                    fields)     ≤600 chars
```

| Stage         | What it sees                                            | What it returns                                                                      |
| ------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Conductor** | The ask, the memory brief, and one line per step so far | `{ kind: "tool" \| "answer" \| "escalate", tool?, brief }`                           |
| **Worker**    | A one-line brief and one tool's schema                  | The arguments, as structured output. Goliath runs the tool and compresses the result |
| **Judge**     | The step log                                            | Escalate on a repeated call, an empty answer, or the step cap                        |
| **Answer**    | The ask, the brief, the step log                        | Two or three sentences                                                               |
| **Scribe**    | The last three exchanges                                | A rolling brief of at most 60 words, updated only when an exchange falls off         |

Nothing a worker saw survives the step. The conductor never sees raw JSON. Those two rules keep the planner's context bounded regardless of tool output size.

## The conductor

The conductor is the only stage that plans. Each step it returns a flat object:

```json
{
  "why": "the user may already have this task",
  "kind": "tool",
  "tool": "listTasks",
  "brief": "see what is open"
}
```

- `why` comes first. A one-sentence rationale before the decision is worth about ten points at
  sub-3B sizes under constrained decoding, because field order is generation order.
- `tool` is an enum of the tools you passed. Constrained decoding cannot invent a name.
- `brief` is what the worker will read. Nothing else from the conductor reaches it.

The conductor also sees how many steps are left and a finish hint at 80% of the cap.

## The worker

A worker gets a fresh context, the brief, and one tool's parameter schema. It asks the model for
the arguments as structured output, validates them, and runs the tool itself. Goliath never
hands tools to the provider. See [Why not a plain loop](/goliath/design/why/) for why that matters
on Apple's stack.

A tool with no parameters skips the model call entirely.

## Compression

Every tool result becomes `key: value` lines capped at 600 characters: a head, an omitted count,
and a tail, with error lines kept through the cut. Past 70% of the window, older step results clip
to one line. Tools may override this with `toModelOutput`.

## The judge

The judge reads the step log and escalates on structural signals:

- the same tool called with the same input twice;
- an empty answer after one nudged retry;
- the step cap (default 5);
- two malformed plans or argument objects in a row;
- two tool errors in a row.

There are no logprobs on device, so there is no confidence score. These are the things a lost 3B
model actually does.

## The answer and the scribe

The answer stage writes two or three sentences from the ask, the brief, and the step log. The
scribe then stores the exchange. The last three exchanges stay verbatim; when one falls off it is
folded into a rolling brief with fixed slots, budgeted at one eighth of the window.
