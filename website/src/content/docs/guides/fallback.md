---
title: Fallback to the cloud
description: Where a turn goes when the phone cannot finish it.
---

A fallback is a function from a `FallbackRequest` to `{ text }`. Goliath calls it when the loop
stalls or the model fails, and marks the result `handledBy: "cloud"`.

```ts
const goliath = createGoliath({
  model: apple(),
  tools,
  fallback: async ({ ask, summary, recent, steps, reason }) => {
    const text = await cloudAgent.turn({ ask, summary, recent, steps, reason });
    return { text };
  },
});
```

The request carries the ask, the memory brief, the recent exchanges, the step log, and the
[reason](/goliath/reference/escalation/). It never carries a transcript: the cloud agent gets the
same summary the conductor had.

## `httpFallback`

For the common case, post it as JSON and read `{ text }` back:

```ts
import { httpFallback } from "@hellohelen-ai/goliath";

createGoliath({
  model: apple(),
  tools,
  fallback: httpFallback({
    url: "https://api.example.com/assistant/turn",
    headers: async () => ({ authorization: `Bearer ${await getToken()}` }),
  }),
});
```

See [the reference](/goliath/reference/http-fallback/) for `readText` and `fetch` overrides.

## Session fallback

Three turns in a row that die on the device with a model error flip `goliath.sessionFallback` to
`true`. From then on, turns go straight to the fallback without paying on-device latency. Claude
Code does the same after three overloads.

Session fallback runs through the same lifecycle as other turns: start, recall, fallback policy,
answer processing, memory, and finalization. After a model-error handoff, Goliath keeps the prior
summary and latest three exchanges without asking the failed device to summarize; older exchanges
are dropped on that route.

## Customizing handoff

Use an extension's `beforeFallback` hook to redact a copy of the outbound request or stop the run
before any cloud call. It covers normal and session fallback. Hook and application failures reject
instead of triggering model-error fallback, and a failing fallback is not invoked a second time.
See [Lifecycle extensions](/goliath/guides/extensions/).

## No fallback

Without one, a stalled turn still returns a best-effort answer written from the step log, with
`bestEffort: true` on the result. The [example app](/goliath/project/example/) deliberately has no
fallback so you can see where the phone gives up.

## What stays on device

A guardrail hit does **not** escalate. Sending the flagged text to a server is the wrong reflex,
and most guardrail hits on tool output are false positives. The turn ends on the device with the
reason `guardrail`.
