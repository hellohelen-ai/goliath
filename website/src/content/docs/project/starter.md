---
title: Starter template
description: Generate your own Expo app from the example and test SDK changes against the packed package.
---

The starter is exported from `example/`, so its screens, agent hooks, tools, and storage use
one maintained source. The exported app uses a pinned npm version of Goliath and carries its
own assets and native context module; it does not depend on the parent repository.

## Create an app

After the template’s initial publication to npm, create an app with:

```sh
bun create expo my-app --template @hellohelen-ai/expo-template-goliath
cd my-app
bun run ios
```

Expo downloads the template, renames the project, marks the generated app private, and installs
its dependencies. The template package is public; your generated app is not published.
You can select a specific template version with `--template @hellohelen-ai/expo-template-goliath@<version>`.
[Expo supports npm templates directly](https://github.com/expo/expo/blob/main/packages/create-expo/README.md).

Until the first npm publication, or when testing unreleased changes, use a local tarball:

```sh
git clone https://github.com/hellohelen-ai/goliath.git
cd goliath
bun install
bun run starter:pack /tmp/goliath-starter
bun create expo my-app --template /absolute/path/printed/by/the/pack/command.tgz
```

CI and release preflight also upload both SDK and template tarballs as `starter-artifacts`.
No second template repository or custom project-creation CLI is needed.

A native development build is required, not Expo Go. Use Xcode 26.4+ on a Mac and an iOS 26+
Apple Intelligence-compatible device or simulator; see the [example prerequisites](/goliath/project/example/).
For a connected iPhone, run `bun run ios --device` and configure signing.

## What you get

- A conversation UI, agent runtime and lifecycle hooks, and Zustand state.
- SQLite conversations and memory, persistent `/notes`, and separate temporary scratch files.
- Demo task tools, file tools, approval buttons, and scripted tests.
- The native context module in `modules/goliath-context/` and a local logo asset.
- An app-specific README describing setup and customization.

Change the agent and tools in `src/agents/goliath/`, screens in `src/screens/`, and branding
in `assets/`. Set your own app name, scheme, and bundle identifier in `app.json` before
shipping. Demo tasks reset each launch; conversations and notes persist. Interrupted tasks
are not resumed automatically, and no cloud fallback is configured.

## Developing the SDK

The repository example keeps a small `metro.config.js` wrapper for loading SDK source directly
and using Fast Refresh. Shared Expo/SVG configuration lives in `metro.base.cjs`; the exporter
uses that as the standalone app's `metro.config.js`, without the local SDK wrapper.

Run the distribution check from the repository root:

```sh
bun run starter:check /tmp/goliath-starter-artifacts
```

It builds and packs the SDK, exports and packs the starter, then uses a pinned `create-expo-app`
CLI to scaffold an app in a temporary directory **outside the checkout**. It installs the SDK
tarball in place of the published version, verifies native-module autolinking, checks types, runs the example's tests, runs Expo
Doctor, and bundles iOS. The temporary app is removed when the command finishes; both tarballs
remain in the output directory.

Every PR runs this check, and release preflight runs it before uploading artifacts. Unit tests
also verify export boundaries and refusal to overwrite an existing project. These checks use
scripted models; native model behavior still needs simulator or device evaluation.

For inspecting the generated source without packing:

```sh
bun run starter:export /tmp/my-goliath-template
```

The destination must not already exist. The exporter only takes application source, tests,
configuration, the native module, branding, and license; it excludes dependencies, generated
native projects, caches, logs, and the example's local dependency lockfile. New source file
types must be explicitly supported by the exporter.

## Updates and publishing

Users own their generated app. They upgrade the SDK using `bun add @hellohelen-ai/goliath@<version>`;
new template versions do not overwrite their app code. Native dependency changes require a
new development build.

The template version and its pinned SDK dependency follow the root package version. Test SDK
changes through the tarball override above, and publish the template only after that SDK
version is available on npm. The tag-triggered `publish.yml` workflow publishes the SDK first,
then its `publish-starter` job publishes the template through the existing `release` environment.

### One-time npm setup for maintainers

A new package needs its own publishing access and trusted-publisher connection; the SDK’s
connection does not authorize the template. This checkout does not contain publishing tokens.
For the initial release, a maintainer with access to the `@hellohelen-ai` scope can:

1. Log in using `npm login` in their terminal.
2. Run `bun run starter:check /tmp/goliath-starter-artifacts` and review the generated package.
3. Confirm the pinned SDK version is already published, then run
   `npm publish /tmp/goliath-starter-artifacts/hellohelen-ai-expo-template-goliath-<version>.tgz --access public`.
4. In the template package’s npm settings, add a GitHub trusted publisher with owner
   `hellohelen-ai`, repository `goliath`, workflow filename `publish.yml`, environment `release`,
   and direct publishing allowed.

Future SDK release tags can then publish both packages without a long-lived npm token.
The environment still requires an allowed reviewer’s approval. A template publication failure
is reported separately from the already-published SDK; it does not undo the SDK release.
See [npm’s trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/).
