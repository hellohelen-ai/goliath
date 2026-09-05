---
title: httpFallback
description: Send a turn to a server as JSON and read back { text }.
---

```ts
import { httpFallback } from "@hellohelen-ai/goliath";

const fallback = httpFallback({ url, headers, fetch, readText });
```

| Option     | Type                                                              | Notes                                              |
| ---------- | ----------------------------------------------------------------- | -------------------------------------------------- |
| `url`      | `string`                                                          | Posted to with `content-type: application/json`    |
| `headers`  | `Record<string, string> \| () => Promise<Record<string, string>>` | Static, or a function when the token rotates       |
| `fetch`    | `typeof fetch`                                                    | Override for tests. Defaults to the global `fetch` |
| `readText` | `(body: unknown) => string`                                       | Pull the answer out. Default reads `{ text }`      |

## The payload

The request body is a `FallbackPayload`: a `FallbackRequest` without `signal`.

```ts
type FallbackPayload = {
  ask: string;
  summary: string;
  recent: Exchange[];
  steps: StepRecord[];
  reason: EscalationReason;
  error?: string;
};
```

A non-2xx response throws `httpFallback: <status> from <url>`. A body without a `text` string
throws unless `readText` is set.
