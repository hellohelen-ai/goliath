# Goliath

[![npm](https://img.shields.io/npm/v/@hellohelen-ai/goliath?color=%23cb3837&logo=npm)](https://www.npmjs.com/package/@hellohelen-ai/goliath)
[![ci](https://github.com/hellohelen-ai/goliath/actions/workflows/ci.yml/badge.svg)](https://github.com/hellohelen-ai/goliath/actions/workflows/ci.yml)
[![provenance](https://img.shields.io/badge/provenance-attested-brightgreen)](https://www.npmjs.com/package/@hellohelen-ai/goliath#provenance)
[![license](https://img.shields.io/npm/l/@hellohelen-ai/goliath)](./LICENSE)

**An agent harness for on-device language models.**

Goliath targets Apple Foundation Models: a language model of roughly three billion parameters that
ships on every iPhone with Apple Intelligence. The model runs locally, at no cost, and no data
leaves the device. It also has a 4,096-token context window and loses track of a task after a few
tool calls. Goliath is designed around that constraint. It plans one step at a time, runs each step
in a fresh context, keeps tool output small, confirms before it changes anything, and hands the
turn to a cloud agent when the device cannot finish.

```sh
npm i @hellohelen-ai/goliath
```

```ts
import { createAgent, defineTool } from "@hellohelen-ai/goliath";
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
  writes: true, // confirmed before it runs
  execute: ({ title }) => convex.mutation(api.tasks.create, { title }),
});

const agent = createAgent({
  model: apple(),
  tools: { listTasks, createTask },
  confirm: async ({ tool, input }) => askTheUser(tool, input),
  fallback: async ({ ask, summary, steps }) => cloudAgent.turn({ ask, summary, steps }),
});

const result = await agent.run("if I don't already have it, add call the dentist");
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

| Option         | Default                     | Notes                                                                      |
| -------------- | --------------------------- | -------------------------------------------------------------------------- |
| `outputSchema` | none                        | Optional Zod schema for a typed device answer; overridable per run         |
| `model`        | required                    | AI SDK model, or a factory returning one                                   |
| `tools`        | `{}`                        | Keep to five or fewer per Goliath. Flat schemas. One-sentence descriptions |
| `memory`       | in-process per conversation | A default `Memory` object or `(conversationId) => Memory` factory          |
| `fallback`     | none                        | Receives the ask, the brief, the step log, and the reason. Returns text    |
| `confirm`      | approve ordinary tools      | `requiresConfirmation` tools decline without a handler                     |
| `window`       | `4096`                      | Input + output window; a number or async capacity callback                 |
| `countTokens`  | estimate                    | Optional async native/provider text tokenizer                              |
| `budgets`      | scales with window          | Optional per-result and aggregate limits for literal tool excerpts         |
| `maxSteps`     | `5`                         | Maximum steps per turn                                                     |
| `instructions` | a careful assistant         | One or two sentences. Every prompt starts with it                          |
| `onEvent`      | none                        | Every trace event as it happens: plan, tool, confirm, escalate, remember   |
| `extensions`   | `[]`                        | Ordered, awaited lifecycle hooks for transformations and policy decisions  |

## Conversations

Configure an agent once and select the conversation on each run:

```ts
const agent = createAgent({ model, tools });
await agent.run("Remember that my meeting is Friday", { conversationId: "work" });
await agent.run("Add milk to my list", { conversationId: "shopping" });
await agent.run("When is my meeting?", { conversationId: "work" });
```

Each ID has independent memory, a request queue, and model-error fallback tracking. Omitting
`conversationId` uses a separate default conversation, preserving existing `run(ask)` behavior.
IDs must be nonempty strings and are not automatically included in prompts. Hooks and tools
receive `conversationId` separately from your application `context`.

For persistent history, provide a memory factory returning a separate storage key per conversation:

```ts
const agent = createAgent({
  model,
  memory: (id) => keyValueMemory(storage, `goliath:${JSON.stringify(id ?? null)}`),
});
```

The factory is called once per conversation per agent instance; `undefined` identifies the
default conversation. A single `Memory` object remains supported for the default conversation;
named runs reject it to prevent accidental history sharing. The default in-process memory lasts
as long as the agent instance. Storage adapters persist conversation history, not paused execution.

Pass `confirm` in run options to handle that request's approvals; it overrides the configured
handler. Existing `signal` and `onEvent` options still apply per request.
`agent.isSessionFallback(id)` reports fallback status for a conversation; `agent.sessionFallback`
continues to report the default conversation's status.

## Structured turn results

Pass a Zod schema to generate the closing answer directly in your app's shape:

```ts
const outputSchema = z.object({
  reply: z.string(),
  action: z.enum(["rest", "walk"]),
});
const agent = createAgent({ model, tools, outputSchema });
const result = await agent.run("Suggest one small thing I can do today");
result.output; // { reply: string; action: "rest" | "walk" } | undefined

// A per-turn schema overrides the default and infers that turn's output type.
const count = await agent.run("How many tasks are open?", {
  outputSchema: z.object({ count: z.number() }),
});
count.output; // { count: number } | undefined
```

The answer uses guided structured generation in the existing answer call. `output` is the
validated value; `text` retains the generated JSON, so memory, answer events, and `afterAnswer`
continue to work without an extra model pass. `afterAnswer` may rewrite `text` for display;
it does not change or revalidate `output`. Schema transforms run once, so `text` may also differ
from the transformed value. Without a schema, the existing prose behavior and token cost stay
unchanged.

Keep schemas flat, with a few short fields. A roughly 3B model still struggles with complex
schemas even when the JSON is valid. Schema tokens count toward the input budget, and the
answer retains its 384-token output cap. Invalid JSON or schema validation gets one guided
retry, then escalates with `answer-invalid`. Without fallback, that failure returns empty
`text` and no `output`. Best-effort device answers also honor the schema and retry once.

`output` is device-only and optional: cloud fallbacks still return text, extension stops have
no structured output, and failed generation may produce no answer. Check `result.output`
before using it. For explicit application context types, use
`createAgent<AppContext, z.infer<typeof outputSchema>>({ model, outputSchema, ... })`, or
supply the schema per `run` call to infer the output type there.

## Extend the lifecycle

An extension groups optional hooks into a reusable object. Register them in the order they should
run. Each hook sees the previous hook's changes; return a patch to change behavior, `deny` to skip
a tool, or `stop` to finish the run with your own text.

```ts
import { createAgent, type GoliathExtension } from "@hellohelen-ai/goliath";

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

const agent = createAgent<AppContext>({ model, tools, extensions: [policy] });
const result = await agent.run("Update my calendar", {
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
newest result. Custom `toModelOutput` strings have the 600-character cap unless the tool sets
`outputMode: "content"`, which uses per-result and aggregate retrieval token budgets. Return only
the fields the next step needs; use filtering and pagination inside tools for larger datasets.

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
const agent = createAgent({
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
Calls to `run()` within the same conversation are serialized so they cannot race its memory;
different conversations can run concurrently. See Apple's [context and token APIs](https://developer.apple.com/videos/play/wwdc2026/241/).

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

The on-device share on the last line is the primary metric for this project.

## Status

Pre-1.0. The core loop, compression, memory, judge, and eval runner are here and tested against a
scripted model. The example includes an Apple token-counting bridge; real-device quality and latency still need measurement. See `docs/` for the
research behind the design.

## Documentation

Guides and the API reference are at
[hellohelen-ai.github.io/goliath](https://hellohelen-ai.github.io/goliath/). The source is in
[`website/`](./website), a separate Starlight app that is not part of the published package or
the example's bundle.

## Example

[`example/`](./example) is an Expo chat app that runs a real turn on the phone's own model —
three tools, a confirmation prompt before anything writes, and suggestions backed by mock tools.
It needs an iOS 26 development build and Apple Intelligence, either on an iPhone or through a
compatible simulator on an Apple silicon Mac running macOS 26 or later.

## Contributing

Issues and pull requests are welcome. `CONTRIBUTING.md` covers the setup, what a good change looks
like, and how releases are cut. Please report security issues
[privately](./SECURITY.md) rather than as a public issue.

Released versions are listed in [`CHANGELOG.md`](./CHANGELOG.md). Every release is published from
CI over OIDC with a provenance attestation — `npm audit signatures` will verify it.

## License

MIT

## Virtual files

Give the agent searchable documents with the optional filesystem module:

```ts
import { createFilesystem, staticFilesystem } from "@hellohelen-ai/goliath/filesystem";

const files = createFilesystem({
  backend: staticFilesystem({ "/guide.md": "Water the basil on Tuesday." }),
});
const agent = createAgent({ model, tools: files.tools });
await agent.run("When should I water the basil?");
```

The default tools are read-only `glob`, literal `grep`, and paginated `readFile`.
Choose `inMemoryFilesystem` for scratch space, `sqliteFilesystem` for persistence, or
`compositeFilesystem` to route different directories to different backends.
Writes are opt-in and require an explicit approval handler. Excerpts automatically use the
harness's context budget. See the [virtual files guide](https://hellohelen-ai.github.io/goliath/guides/filesystem/)
and [API reference](https://hellohelen-ai.github.io/goliath/reference/filesystem/).

For a step-by-step visual explanation, open [the standalone harness walkthrough](docs/harness-walkthrough.html)
in a browser. It works offline and includes the normal, approval, repeated-call, refusal,
malformed-plan, and file-retrieval paths.

To start your own Expo app from the example, run `bun run starter:pack /tmp/goliath-starter`
from a checkout, then pass the printed tarball path to `bun create expo my-app --template <path>`.
The [starter guide](https://hellohelen-ai.github.io/goliath/project/starter/) covers customization,
updates, and testing the packaged SDK outside this repository.
