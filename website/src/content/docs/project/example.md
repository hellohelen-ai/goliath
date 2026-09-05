---
title: Example app
description: An Expo chat app that runs a real turn on the phone's own model.
---

[`example/`](https://github.com/hellohelen-ai/goliath/tree/main/example) in the repository is a
chat app: three tools, a confirmation prompt before anything writes, and suggestions backed by mock tools.

Ask it something like _"if I don't already have it, add call the dentist"_ and watch: Goliath
lists the tasks, decides whether the task is already there, asks before it writes, and answers.
Every step runs on the device.

## What you need

- **An iPhone with Apple Intelligence turned on, running iOS 26 or later**, or a compatible
  iOS 26 simulator on an Apple silicon Mac with macOS 26 or later and Apple Intelligence ready.
  The simulator uses the Mac's model. See [Apple's guidance](https://developer.apple.com/forums/thread/787445).
- **A development build.** `@react-native-ai/apple` is a native module, so Expo Go cannot load it.

## Running it

```sh
bun install
bun run build
cd example
bun install
bun run ios
```

Use `bun run ios --device` for a connected iPhone. After the first build, `bun run start` is enough.
Metro loads the local harness source directly, so edits to `src/` and `example/` use Fast Refresh.

## What to look at

- `src/tasks.ts`: three tools. `createTask` and `completeTask` are `writes: true`, which is why
  they prompt. The parameters are flat, which is what a 3B model fills in reliably.
- `src/screens/home/home-screen.tsx`: composes focused inbox, chat, and sheet components.
- `src/stores/app-store.ts`: Zustand state for conversations, drafts, navigation, and search.
  State is held in memory for the current app session.
- `src/hooks/`: navigation, search, input/scrolling, and one `createAgent` per conversation.
  Conversation memory is separate; demo tasks are shared. Lifecycle events log to the console.
- `src/tools/mock-tools.ts`: the shared catalog for the agent’s tools and suggested requests.

There is deliberately **no** `fallback`. The example is about what the phone finishes on its own;
a cloud fallback would hide the moments when it cannot.

The example is tested, typechecked, doctored, and bundled in CI so it cannot drift from the public API.
