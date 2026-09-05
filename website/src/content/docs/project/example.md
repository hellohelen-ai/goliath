---
title: Example app
description: A one-screen Expo app that runs a real turn on the phone's own model.
---

[`example/`](https://github.com/hellohelen-ai/goliath/tree/main/example) in the repository is a
one-screen Expo app: three tools, a confirmation prompt before anything writes, and the step log on
screen.

Ask it something like _"if I don't already have it, add call the dentist"_ and watch: Goliath
lists the tasks, decides whether the task is already there, asks before it writes, and answers.
Every step runs on the device.

## What you need

- **An iPhone with Apple Intelligence turned on, running iOS 26 or later.** The Simulator has no
  on-device model and will show "No on-device model".
- **A development build.** `@react-native-ai/apple` is a native module, so Expo Go cannot load it.

## Running it

```sh
cd example
bun install
bun run prebuild
bun run ios --device
```

After the first build, `bun run start` is enough.

## What to look at

- `src/tasks.ts`: three tools. `createTask` and `completeTask` are `writes: true`, which is why
  they prompt. The parameters are flat, which is what a 3B model fills in reliably.
- `app/index.tsx`: `createGoliath` wired to `apple()`, with `confirm` bound to an `Alert`.

There is deliberately **no** `fallback`. The example is about what the phone finishes on its own;
a cloud fallback would hide the moments when it cannot.

The example is typechecked, doctored, and bundled in CI so it cannot drift from the public API.
