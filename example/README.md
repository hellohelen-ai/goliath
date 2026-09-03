# Goliath example

One screen, three tools, and a turn that runs on the phone's own model.

Ask it something like _"if I don't already have it, add call the dentist"_ and watch the step log:
Goliath lists the tasks, decides whether the task is already there, asks before it writes, and
answers. Every step runs on the device.

## What you need

- **An iPhone with Apple Intelligence turned on, running iOS 26 or later.** The Simulator has no
  on-device model, so it will show "No on-device model" and stop.
- **A development build.** `@react-native-ai/apple` is a native module, so Expo Go cannot load it.

## Running it

```sh
bun install
bun run prebuild
bun run ios --device
```

`bun run ios --device` builds and installs on a connected iPhone. After the first build,
`bun run start` is enough.

## What to look at

- `src/tasks.ts` — three tools. `createTask` and `completeTask` are marked `writes: true`, which
  is why they prompt before running. Note the parameters are flat: primitives only, which is what a
  3B model fills in reliably.
- `app/index.tsx` — `createGoliath` wired to `apple()`, with `confirm` bound to an `Alert`.

There is deliberately **no** `fallback` configured. This example is about what the phone finishes
on its own; adding a cloud fallback would hide the moments when it cannot.

## Using your local checkout

The app installs `@hellohelen-ai/goliath` from npm. To run it against the source in this repo:

```sh
cd .. && bun run build && cd example
bun add ../
```
