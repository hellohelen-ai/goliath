# Goliath

[![npm](https://img.shields.io/npm/v/@hellohelen-ai/goliath?color=%23cb3837&logo=npm)](https://www.npmjs.com/package/@hellohelen-ai/goliath)
[![ci](https://github.com/hellohelen-ai/goliath/actions/workflows/ci.yml/badge.svg)](https://github.com/hellohelen-ai/goliath/actions/workflows/ci.yml)
[![provenance](https://img.shields.io/badge/provenance-attested-brightgreen)](https://www.npmjs.com/package/@hellohelen-ai/goliath#provenance)
[![license](https://img.shields.io/npm/l/@hellohelen-ai/goliath)](./LICENSE)

**An agent harness for the phone's own model.**

Apple ships a ~3B language model on every iPhone with Apple Intelligence. It is free, private, and
fast. It also has a 4,096-token window and gets lost after a few tool calls. Goliath is the loop
that makes it useful anyway: it plans one step at a time, runs each step in a fresh context, keeps
tool output small, asks before it changes anything, and hands the turn to a cloud agent when the
phone cannot finish.

It only needs one stone.

```sh
npm i @hellohelen-ai/goliath
```

```ts
import { createGoliath, defineTool } from "@hellohelen-ai/goliath";
import { apple } from "@react-native-ai/apple";
import { z } from "zod";

const listTasks = defineTool({
  name: "listTasks",
  description: "The user's open tasks.",
  parameters: z.object({}),
  execute: () => convex.query(api.tasks.list, {}),
});

const createTask = defineTool({
  name: "createTask",
  description: "Add a task.",
  parameters: z.object({ title: z.string() }),
  writes: true, // Goliath asks before running it
  execute: ({ title }) => convex.mutation(api.tasks.create, { title }),
});

const goliath = createGoliath({
  model: apple(),
  tools: { listTasks, createTask },
  confirm: async ({ tool, input }) => askTheUser(tool, input),
  fallback: async ({ ask, summary, steps }) => cloudAgent.turn({ ask, summary, steps }),
});

const result = await goliath.run("if I don't already have it, add call the dentist");
result.text; // "Added Call the dentist. You now have three open tasks."
result.handledBy; // "device" | "cloud"
result.steps; // what it did, one line each
```

Any [AI SDK](https://ai-sdk.dev) language model works. On a phone that is
[`@react-native-ai/apple`](https://ai-sdk.dev/providers/community-providers/react-native-apple);
in a test it is the scripted model from `@hellohelen-ai/goliath/testing`.

## How a turn runs

```
ask ──► recall ──► conductor ──► worker ──► judge ──► … ──► answer ──► remember
            │          │            │          │
         memory    next stone   fresh ctx   stalled?
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

Nothing a worker saw survives the step. The conductor never sees raw JSON. That is the whole trick.

## Why not just call the model in a loop

You can. The AI SDK's `generateText` with `stopWhen` is that loop, and Apple's own session runs a
tool loop natively. Both fall over on a phone for the same reasons:

- **The window fills.** One JSON tool result can be a thousand tokens. Three of them and the model
  has forgotten the ask.
- **Many tools confuse a small model.** Past about five definitions, it picks wrong or invents
  arguments. Goliath gives each worker one.
- **Apple runs its loop out of sight.** Under the Callstack provider, tools are pre-registered and
  executed inside Apple's own session; the AI SDK sees one step and `stopWhen` never fires. Goliath
  never hands tools to the provider. It asks for the arguments as structured output, which Apple's
  guided generation constrains at decode time, then runs the tool itself.
- **There is no confidence signal.** No logprobs on device. Goliath watches for the things a lost
  3B model does: repeats itself, answers with nothing, runs past the cap.

## What you supply

| Option         | Default             | Notes                                                                      |
| -------------- | ------------------- | -------------------------------------------------------------------------- |
| `model`        | required            | Any AI SDK `LanguageModel`                                                 |
| `tools`        | `{}`                | Keep to five or fewer per Goliath. Flat schemas. One-sentence descriptions |
| `memory`       | in-process          | `{ load, save }` over `{ summary, recent }`. Persist it however you like   |
| `fallback`     | none                | Receives the ask, the brief, the step log, and the reason. Returns text    |
| `confirm`      | approve all         | Asked before any `writes: true` tool runs                                  |
| `window`       | `4096`              | Apple Foundation Models. The brief is budgeted at one eighth of it         |
| `maxSteps`     | `5`                 | Five stones                                                                |
| `instructions` | a careful assistant | One or two sentences. Every prompt starts with it                          |
| `onEvent`      | none                | Every trace event as it happens: plan, tool, confirm, escalate, remember   |
| `extensions`   | `[]`                | Ordered, awaited lifecycle hooks for transformations and policy decisions  |

## Extend the lifecycle

An extension groups optional hooks into a reusable object. Register them in the order they should
run. Each hook sees the previous hook's changes; return a patch to change behavior, `deny` to skip
a tool, or `stop` to finish the run with your own text.

```ts
import { createGoliath, type GoliathExtension } from "@hellohelen-ai/goliath";

type AppContext = { canWrite: boolean; allowCloud: boolean };

const policy: GoliathExtension<AppContext> = {
  name: "app-policy",
  beforeTool({ tool, context }) {
    if (tool.writes && !context.canWrite) {
      return { action: "deny", reason: "This account has read-only access." };
    }
  },
  beforeFallback({ context }) {
    if (!context.allowCloud) {
      return {
        action: "stop",
        text: "I could not finish on this device. Cloud processing is disabled.",
        reason: "cloud-disabled",
      };
    }
  },
};

const goliath = createGoliath<AppContext>({ model, tools, extensions: [policy] });
const result = await goliath.run("Update my calendar", {
  context: { canWrite: false, allowCloud: false },
});
result.stopped; // { extension, phase, reason } when an extension stops the run
```

Hooks cover run start, recall, planning, tool calls, fallback, answers, memory, errors, and
finalization. They receive a run ID, cancellation signal, application context, and a private
`state` map for that extension and run. Application context never enters prompts or memory
automatically. Input rewrites are validated before write confirmation; cached reads also pass
through policy checks.

Hook failures reject with `GoliathExtensionError` instead of triggering cloud fallback.
`onFinish` runs on success, stop, error, and cancellation. Cleanup errors are isolated; successful
results expose them in `result.diagnostics`. Keep `onEvent` for trace observation.

See the [extension API and execution contract](https://hellohelen-ai.github.io/goliath/guides/extensions/)
for every hook, return type, budget rule, and persistence detail.

## Testing without a phone

```ts
import { fakeModel } from "@hellohelen-ai/goliath/testing";

const model = fakeModel([
  { json: { kind: "tool", tool: "listTasks", brief: "see what is open" } },
  { toolCall: { name: "listTasks", input: {} } },
  { json: { kind: "answer", brief: "reply" } },
  { text: "You have two tasks: buy milk and call mom." },
]);
```

The script is consumed in order and a test fails if it runs out, so a passing test proves the
harness sent exactly the prompts you expected. `model.calls` holds every prompt for assertions.

## Evals

`evals/fixtures.ts` holds the asks a personal assistant hears every day, with the tool calls a good
run makes and where it should finish. `runEvals` scores any model against them and prints the
split:

```
PASS  list-today         device    412ms
PASS  add-task           device    655ms
PASS  add-after-check    device   1203ms
PASS  small-talk         device    198ms
PASS  plan-week          cloud     301ms

5/5 passed · 4 on device · 1 escalated
```

That last line is the number this project exists for.

## Status

Early. The core loop, compression, memory, judge, and eval runner are here and tested against a
scripted model. On-device runs and the Apple provider adapter are next. See `docs/` for the
research behind the design.

## Documentation

Guides and the API reference are at
[hellohelen-ai.github.io/goliath](https://hellohelen-ai.github.io/goliath/). The source is in
[`website/`](./website), a separate Starlight app that is not part of the published package or
the example's bundle.

## Example

[`example/`](./example) is a one-screen Expo app that runs a real turn on the phone's own model —
three tools, a confirmation prompt before anything writes, and the step log on screen. It needs an
iPhone with Apple Intelligence on iOS 26 and a development build; the Simulator has no on-device
model.

## Contributing

Issues and pull requests are welcome. `CONTRIBUTING.md` covers the setup, what a good change looks
like, and how releases are cut. Please report security issues
[privately](./SECURITY.md) rather than as a public issue.

Released versions are listed in [`CHANGELOG.md`](./CHANGELOG.md). Every release is published from
CI over OIDC with a provenance attestation — `npm audit signatures` will verify it.

## License

MIT
