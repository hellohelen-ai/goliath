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
| `model`        | required            | AI SDK model, or a factory returning one                                   |
| `tools`        | `{}`                | Keep to five or fewer per Goliath. Flat schemas. One-sentence descriptions |
| `memory`       | in-process          | `{ load, save }` over `{ summary, recent }`. Persist it however you like   |
| `fallback`     | none                | Receives the ask, the brief, the step log, and the reason. Returns text    |
| `confirm`      | approve all         | Asked before any `writes: true` tool runs                                  |
| `window`       | `4096`              | Input + output window; a number or async capacity callback                 |
| `countTokens`  | estimate            | Optional async native/provider text tokenizer                              |
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

## Keeping requests inside the context window

Every model call now budgets the system prompt, user prompt, and serialized output schema.
Input is limited to 70% of `window`, or less if needed to reserve the output cap plus provider
overhead (10% of the window, at least 128 tokens). Output caps are 256 tokens for planning, 512
for tool arguments, 384 for answers, and 192 for memory updates. Setting `window: 8192` is only
appropriate when the underlying model/session actually supports 8192 tokens.

Before a call, the rolling brief is clipped to one eighth of the window. If a planner or answer
prompt is still too large, older tool results are shortened while keeping every step and the
newest result. Custom `toModelOutput` strings also have the 600-character cap. Return only the
fields the next step needs; use filtering and pagination inside tools for larger datasets.

Without lifecycle extensions, if the request still cannot fit, Goliath emits `escalate` with reason `context-budget` and calls
your configured fallback with the original ask and step records. It does not truncate the current
ask or instructions to squeeze an action through. Without a fallback, the result has empty text;
use the trace reason to ask the user to narrow the request. A budget rejection does not count
toward session fallback, because it says nothing about the device model's availability.
With extensions configured, an oversized active-loop prompt instead rejects with `GoliathBudgetError`
and runs `onError`/`onFinish`, preserving the extension API's failure contract.

Use `onEvent` to inspect `{ type: "budget", label, tokens, limit, source }` for each attempted model
call. `label` identifies `conductor`, `worker`, `answer`, or `scribe`. `source` is `tokenizer` when
`countTokens` is configured and `estimate` otherwise. The counter sees the system text, serialized
output schema, and prompt together. Provider framing and schema conversion still need headroom;
these counts are not a guarantee about a provider's final native transcript. A failing counter
stops generation rather than silently switching to an estimate.

For a provider with native accounting:

```ts
const goliath = createGoliath({
  model: () => apple(),
  window: () => nativeContext.contextSize(),
  countTokens: (text) => nativeContext.countTokens(text),
  tools: { listTasks, createTask },
});
```

`nativeContext` is your native bridge. The [example module](./example/modules/goliath-context/)
implements it for Apple Foundation Models, with native counting on iOS 26.4+ and estimates on
older releases. A model factory is called for each generation, including retries and memory
updates. Providers must still start fresh sessions internally and honor `maxOutputTokens`.
Calls to `run()` on one Goliath instance are serialized so overlapping requests cannot race its
memory. See Apple's [context and token APIs](https://developer.apple.com/videos/play/wwdc2026/241/).

Memory maintenance is best effort: an oversized or failed scribe call emits `memory-error`, keeps
the previous brief and latest three exchanges, and preserves the completed answer. Evicted
exchanges are not folded into the brief when that update fails. After a device model failure,
remembering a cloud answer skips the device call altogether.

## Task context and exact tool handoffs

Recent conversation now reaches the planner, worker, and answer stages. It receives a separate
one-eighth-window allowance, selected newest first. Workers also see the relevant prerequisite
results, or the latest step when no prerequisites are declared. Step status explicitly identifies
completed, skipped, failed, and cached actions.

The model sees compact result strings. Application code can read the full JSON-serializable
output from `StepRecord.output`, through `ToolContext.steps` for the current turn and
`ToolContext.recent` for earlier exchanges. The last three stored exchanges also retain their
step records. Raw outputs never enter device prompts automatically. Non-serializable outputs
are omitted; keep durable or larger archives in the app's own store. Configured cloud fallbacks
receive these records too, so their payloads can be larger than the device prompts.

Use `resolveInput` when a short model-selected reference needs an exact value from a lookup:

```ts
const sendMessage = defineTool({
  name: "sendMessage",
  description: "Send a message using a contact reference from lookupContact.",
  parameters: z.object({ contact: z.string(), text: z.string() }),
  writes: true,
  requires: ["lookupContact"],
  resolveInput: (args, context) => {
    const output = [...(context.steps ?? [])]
      .reverse()
      .find((step) => step.tool === "lookupContact")?.output;
    // The app checks the selected reference and returns its canonical ID.
    const contacts = z.array(z.object({ ref: z.string(), id: z.string() })).parse(output);
    const selected = contacts.find((contact) => contact.ref === args.contact);
    if (!selected) throw new Error("Unknown contact reference");
    return { ...args, contact: selected.id };
  },
  execute: ({ contact, text }) => sendToContact(contact, text),
});
```

Keep `resolveInput` free of side effects. Its output is validated against the tool schema before
confirmation. Missing prerequisites stop the action with `tool-prerequisite-missing`. Duplicate
arguments are checked after resolution and before confirmation or execution, regardless of object
key order. An identical successful read can be reused once; a subsequent write invalidates it.
Duplicate suppression is scoped to a turn. Apps still own transaction/idempotency guarantees
across crashes, separate instances, or new user turns.

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
scripted model. The example includes an Apple token-counting bridge; real-device quality and latency still need measurement. See `docs/` for the
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
