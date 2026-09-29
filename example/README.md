# Goliath example

A dark chat interface, task and file tools, and an agent running on the phone’s own model.

Ask it something like _"if I don't already have it, add call the dentist"_ and follow the conversation:
Goliath lists the tasks, decides whether the task is already there, asks before it writes, and
answers. Every step runs on the device.

## What you need

- **An iPhone with Apple Intelligence turned on, running iOS 26 or later**, or an iOS 26
  simulator on an Apple silicon Mac with macOS 26 or later and Apple Intelligence ready.
  The simulator uses the Mac's model; keep the macOS and simulator versions compatible.
  See [Apple's simulator guidance](https://developer.apple.com/forums/thread/787445).
- **Node.js 20.19.4 or newer and Xcode 26.4 or newer.** The token-counting bridge uses the newer SDK while keeping iOS 26 as the deployment target.
- **A development build.** `@react-native-ai/apple` is a native module, so Expo Go cannot load it.

## Running it

From the repository root:

```sh
bun install
bun run build
cd example
bun install --backend=copy
bun run ios
```

`bun run ios` builds and installs on the simulator. Use `bun run ios --device` for a connected
iPhone. After the first build, `bun run start` is enough. If another workspace uses the default
port, pass `--port "$CONDUCTOR_PORT"` to either command.

## What to look at

- `src/agents/goliath/agent.ts` — assembles the Apple model, native context options, tools, and
  lifecycle extensions; exports one shared agent serving every conversation.
- `src/agents/goliath/runtime.ts` — adapts approval buttons and cancellation to
  `agent.run(text, { conversationId, confirm, signal })`; independent of React and Zustand.
- `src/agents/goliath/use-goliath-agent.ts` — owns the runtime for the mounted screen and
  disposes pending work on unmount.
- `src/hooks/use-conversations.ts` — starts a message, calls `agent.ask`, and saves the result
  or error; connects approval requests and buttons to conversation state.
- `src/agents/goliath/lifecycle/` — lifecycle and trace logging, separate from React and UI state.
- `src/agents/goliath/tools/tasks/` — three tools. `createTask` and `completeTask` are marked `writes: true`, which
  is why they prompt before running. Note the parameters are flat: primitives only, which is what a
  3B model fills in reliably.
- `modules/goliath-context/` — a local Expo module exposing native capacity and token counting. Counting is enabled on iOS 26.4+; older releases use the harness estimate. Native tokenization counts prompt text and the serialized schema; the harness still reserves space for provider formatting.
- `app/index.tsx` — the Expo route, which exports `HomeScreen`.
- `src/screens/home/home-screen.tsx` — a small composition of inbox, conversation, and sheets.
- `src/screens/home/components/` — focused UI components for messages, confirmations, search,
  suggestions, and the composer.
- `src/stores/app-store.ts` — Zustand state for conversations, drafts, navigation, and search,
  with actions that route background replies to the correct conversation.
- `src/storage/` — SQLite conversations, messages, and agent memory; startup restoration,
  interrupted request recovery, and ordered persistence of Zustand changes.
- `src/hooks/` — home actions, Zustand subscriptions, and chat input/scrolling.
- `src/agents/goliath/tools/index.ts` — registered mock tools and their suggestion metadata. Both the
  welcome card and the suggestion sheet read this catalog.
- `src/ui/agent-mark.tsx` — the shared stone SVG imported from the docs site; native SVG support
  requires a development build after installing dependencies.

Conversations, drafts, completed replies, approval decisions, and agent memory survive app restarts
in the local `goliath.db` SQLite database. Demo tasks still reset each app session.
Search filters actual conversation content, and suggested requests fill the composer for editing before sending.
Store and runtime behavior are covered by `bun run test` from the example directory and the example CI job.
Runtime tests use the harness's scripted `fakeModel`, including approval and cancellation paths.

Agent-specific code lives together, while screens and shared UI stay outside the agent module:

```text
src/
├── agents/
│   └── goliath/
│       ├── agent.ts
│       ├── runtime.ts
│       ├── use-goliath-agent.ts
│       ├── index.ts
│       ├── filesystem/       # routes, scopes, and reference documents
│       ├── lifecycle/
│       │   └── logging.ts
│       └── tools/
│           ├── index.ts
│           └── tasks/
│               ├── create-task.ts
│               ├── list-task.ts
│               ├── complete-task.ts
│               ├── types.ts
│               ├── mock-store.ts
│               └── index.ts
├── screens/home/
│   ├── components/
│   └── home-screen.tsx
├── hooks/
├── stores/
├── storage/
└── ui/
```

The conversation hook coordinates state changes around an agent request:

```ts
const result = await agent.ask(conversationId, text, {
  onApproval: (request) => requestApproval(message, request),
});
completeTurn(message, result);
```

Goliath selects each conversation's memory and request queue internally using its ID.
The UI state store holds messages and drafts; it never holds agent instances or pending promises.
The memory factory in `agent.ts` uses the same conversation ID to restore the agent's compacted
context. The full visible transcript is stored separately, so compaction does not remove old chat messages.

The app waits for restoration before opening the inbox and saves user messages before starting
the agent. Failed conversation writes keep unsaved changes in memory and show a retry screen.
On restart, unfinished requests become **interrupted**, unanswered approvals become cancelled,
and **Edit and retry** copies the original request into the composer for review. Previously allowed
actions retain their decision; some tool steps may already have finished. Running promises and
tool execution are not resumed automatically.

After adding or updating the SQLite native module, run `bun run ios` to rebuild the development
client. Persistence tests use a real SQLite file, close it, and reopen it with a fresh app store and
agent. They also cover isolated context, interrupted approvals, failed writes, and transaction rollback.

There is deliberately **no** `fallback` configured. This example is about what the phone finishes
on its own; adding a cloud fallback would hide the moments when it cannot.

## Make your own app

After the template’s initial npm publication, run
`bun create expo my-app --template @hellohelen-ai/expo-template-goliath`. The generated app
uses the published SDK, contains its own assets, and retains the native context module.
See the [starter guide](https://hellohelen-ai.github.io/goliath/project/starter/) for setup,
customization, and testing SDK changes against the packaged starter.

## Using your local checkout

The package dependency links to the parent checkout. Metro loads `../src/index.ts` directly
and watches the harness source, so edits to `src/` and `example/` appear through Fast Refresh
without rebuilding the library. Native dependency changes still require `bun run ios`.

For type checking on a fresh checkout, run `bun install && bun run build` at the repository
root first; the package's type declarations are generated in `dist/`.

`--backend=copy` avoids filesystem clone issues with local directory dependencies. CI builds
the library before checking the example.

`completeTask` demonstrates a structured handoff: it requires a successful `listTasks`, then
validates the selected ID against that lookup before asking for confirmation.

## Try virtual files

The agent registers file tools alongside the mock task tools. Try the suggestions **Read the file
guide**, **Find the greenhouse code**, and **Save a note**, or ask:

- “Read /docs/guide.md.”
- “Find the greenhouse access code in /docs.”
- “Create /notes/garden.md with the text: Water the basil on Tuesday.”
- “Read /notes/garden.md.”

Approve the save, restart the app, and read the note again. Notes are stored in the separate
`goliath-files.db` database and shared by this app's conversations. `/docs` contains static,
read-only reference files. Other paths use temporary scratch storage scoped to each conversation.
Demo tasks and scratch files reset on launch; conversations and notes persist.

The composition lives in `src/agents/goliath/filesystem/`: `documents.ts` supplies references,
`backend.ts` defines routes and scopes, and `index.ts` chooses the exposed tools.
Delete is available in the library but not registered in the example.

## Native checks and real-model evals

Run `bun run native:check` from the repository root to typecheck the context metrics for iOS 26
device and simulator targets using Xcode 26.4+. CI additionally builds the full simulator app.
These checks do not run inference.

`src/agents/goliath/evaluate.ts` exports `runAppleEvals({ device, signal? })`. Call it explicitly
from a development action while no chat generation is running. It uses the same native capacity
and tokenizer as the chat agent, fresh model instances per generation, and three attempts per
fixture. Its tools and memory are disposable; it does not modify your app's tasks or conversations.
Save the returned report alongside the exact provider version and device/OS details. The fallback
is a scripted handoff acknowledgement, so the report does not measure cloud answer quality.
`bun run evals` at the repository root is only a scripted runner smoke test.
