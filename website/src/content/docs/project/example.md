---
title: Example app
description: An Expo chat app that runs a real turn on the phone's own model.
---

[`example/`](https://github.com/hellohelen-ai/goliath/tree/main/example) in the repository is a
chat app: task and file tools, a confirmation prompt before anything writes, and editable suggestions.

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

- `src/agents/goliath/agent.ts`: exports one configured agent with the model, tools, and lifecycle extensions.
- `src/agents/goliath/runtime.ts`: adapts approval buttons and cancellation to conversation-aware `agent.run` calls.
- `src/agents/goliath/use-goliath-agent.ts`: owns the runtime and disposes pending work on unmount.
- `src/hooks/use-conversations.ts`: connects agent results and approvals to Zustand conversation actions.
- `src/agents/goliath/lifecycle/`: lifecycle and trace logging.
- `src/agents/goliath/tools/tasks/`: three tools. `createTask` and `completeTask` are `writes: true`, which is why
  they prompt. The parameters are flat, which is what a 3B model fills in reliably.
- `src/screens/home/home-screen.tsx`: composes focused inbox, chat, and sheet components.
- `src/stores/app-store.ts`: Zustand state for conversations, drafts, navigation, and search.
- `src/storage/`: local SQLite persistence for conversations, messages, and agent memory;
  restores chat state before the inbox opens and saves subsequent conversation changes.
- `src/hooks/`: navigation, search, Zustand subscriptions, and input/scrolling.
- `src/agents/goliath/tools/index.ts`: the catalog for the agent’s tools and suggested requests.

One agent serves every conversation, with Goliath managing isolated memory and queues by
`conversationId`; demo tasks are shared across conversations. Zustand holds the UI state.
Conversations, drafts, replies, and the agent's compacted context survive app restarts. Full
chat history is stored separately from compacted memory. Demo tasks reset each app session.

Unfinished requests reopen as **interrupted**, with unanswered approvals cancelled. **Edit and retry**
puts the original request in the composer for review; no tool runs automatically on restart.
Previously approved steps may already have completed. Failed conversation writes show a retry
screen and retain unsaved changes in memory. Rebuild the development client after installing
the `expo-sqlite` native dependency.

There is deliberately **no** `fallback`. The example is about what the phone finishes on its own;
a cloud fallback would hide the moments when it cannot.

The example is tested, typechecked, doctored, and bundled in CI so it cannot drift from the public API.

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
