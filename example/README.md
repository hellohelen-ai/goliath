# Goliath example

A dark chat interface, three tools, and an agent running on the phone’s own model.

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

- `src/tasks.ts` — three tools. `createTask` and `completeTask` are marked `writes: true`, which
  is why they prompt before running. Note the parameters are flat: primitives only, which is what a
  3B model fills in reliably.
- `modules/goliath-context/` — a local Expo module exposing native capacity and token counting. Counting is enabled on iOS 26.4+; older releases use the harness estimate. Native tokenization counts prompt text and the serialized schema; the harness still reserves space for provider formatting.
- `app/index.tsx` — the Expo route, which exports `HomeScreen`.
- `src/screens/home/home-screen.tsx` — a small composition of inbox, conversation, and sheets.
- `src/screens/home/components/` — focused UI components for messages, confirmations, search,
  suggestions, and the composer.
- `src/stores/app-store.ts` — Zustand state for conversations, drafts, navigation, and search,
  with actions that route background replies to the correct conversation.
- `src/hooks/` — home actions, chat input/scrolling, and one `createAgent` per
  conversation. Task writes wait for Allow or Cancel; lifecycle events log to the console.
- `src/tools/mock-tools.ts` — registered mock tools and their suggestion metadata. Both the
  welcome card and the suggestion sheet read this catalog.
- `src/ui/agent-mark.tsx` — the shared stone SVG imported from the docs site; native SVG support
  requires a development build after installing dependencies.

Conversations and tasks are held in memory for the current app session. Search filters actual
conversation content, and suggested requests fill the composer for editing before sending.
Store behavior is covered by `bun run test` from the example directory and the example CI job.

There is deliberately **no** `fallback` configured. This example is about what the phone finishes
on its own; adding a cloud fallback would hide the moments when it cannot.

## Using your local checkout

The package dependency links to the parent checkout. Metro loads `../src/index.ts` directly
and watches the harness source, so edits to `src/` and `example/` appear through Fast Refresh
without rebuilding the library. Native dependency changes still require `bun run ios`.

For type checking on a fresh checkout, run `bun install && bun run build` at the repository
root first; the package's type declarations are generated in `dist/`.

`--backend=copy` avoids filesystem clone issues with local directory dependencies. CI builds
the library before checking the example.

`completeTask` demonstrates a structured handoff: it requires a successful `listTasks`, then
resolves the selected title to an exact saved ID before asking for confirmation.
