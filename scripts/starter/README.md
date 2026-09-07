# Your Goliath app

An Expo app with an on-device agent, conversations, approval buttons, Zustand state,
SQLite storage, and task/file tools. This project is yours to edit.

## Run it

Use Bun, Node.js 24, and Xcode 26.4 or newer on a Mac. The app targets iOS 26+ and needs
Apple Intelligence enabled on a compatible iPhone, or a compatible iOS simulator and Mac.
Expo Go cannot run the native model or context module: build a development client.

```sh
bun install
bun run ios
```

For your own iPhone, use `bun run ios --device` and follow Xcode signing setup.
After the first build, use `bun run start` for JavaScript edits. Rebuild with `bun run ios`
after native dependencies or `modules/` change.

Before distributing the app, choose your own `name`, `slug`, `scheme`, and
`ios.bundleIdentifier` in `app.json`; the first device build can prompt for a bundle identifier.

## Make it yours

- `src/agents/goliath/agent.ts`: instructions, model, tools, and memory configuration.
- `src/agents/goliath/tools/`: replace the demo tools with your own app functions.
- `src/agents/goliath/filesystem/`: read-only reference documents, saved notes, and scratch files.
- `src/agents/goliath/lifecycle/`: lifecycle hooks and development logging.
- `src/screens/home/`: screens and child components.
- `src/hooks/` and `src/stores/`: UI coordination and Zustand state.
- `src/storage/`: SQLite persistence for conversations and agent memory.
- `modules/goliath-context/`: the local native module for context capacity and token counting.
- `assets/stone.svg`: replaceable branding.

Demo tasks reset when the app restarts; conversations and files under `/notes` persist.
Scratch files are temporary and separate for each conversation. The app asks before writes.
The agent has no cloud fallback configured and does not resume interrupted work automatically.

## Check your changes

```sh
bun run typecheck
bun run test
bun run doctor
bun run bundle
```

Tests use a scripted model and real SQLite storage. Bundling verifies imports; neither proves
that the on-device model chooses correct actions. Try representative requests on your device.

## Update the harness

Goliath is a normal npm dependency pinned to the version used to produce this starter.
Choose a newer version after reviewing its release notes, then run the checks above:

```sh
bun add @hellohelen-ai/goliath@<version>
```

Package upgrades do not overwrite your screens, tools, or configuration. New template versions
only change newly generated apps; apply any desired app changes yourself.

[Harness documentation](https://hellohelen-ai.github.io/goliath/)
