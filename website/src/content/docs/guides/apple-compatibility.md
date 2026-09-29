---
title: Apple compatibility
description: Runtime context accounting, native build checks, and boundaries for new Apple APIs.
---

Goliath's core is provider-neutral TypeScript. The example supplies the Apple provider and an Expo
bridge for native token accounting. Keep those layers distinct when adopting new platform APIs.

## Context capacity and token counting

`window` accepts a number or an async callback, resolved once per turn. `countTokens` accepts the
selected model's tokenizer. The example calls `SystemLanguageModel.default.contextSize` and uses
`tokenCount(for:)` on iOS 26.4+. Older runtimes retain estimated token counting; the deployment
target stays iOS 26.0. A supported tokenizer failure surfaces instead of silently undercounting.

Use the model's reported capacity. Apple documentation and WWDC examples show differing capacities;
a global switch from 4K to 8K is not justified. Goliath keeps 4,096 as its conservative default.
When selecting another model, keep the tokenizer and capacity matched to that model.
The local bridge measures only `SystemLanguageModel.default`.

Sources: [contextSize](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel/contextsize),
[tokenCount](<https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel/tokenCount(for:)>),
[Apple's overview](https://developer.apple.com/videos/play/wwdc2026/241/).

## Native verification

The example needs Xcode 26.4+ to compile its newer token APIs. From the repository root:

```sh
bun run native:check
```

This typechecks the Foundation Models metrics against device and simulator SDKs with an iOS 26.0
minimum target. CI also prebuilds the Expo app, installs Pods, and compiles the whole simulator app
without signing. That catches bridge and provider build failures which Metro cannot detect.
Neither check proves inference quality. Run the [device evals](/goliath/guides/evals/) separately.
To test a newly installed Xcode, set `DEVELOPER_DIR` when invoking the native check.

## Provider release boundary

Checked September 29, 2026: npm's latest `@react-native-ai/apple` is 0.12.0. Upstream `main` exposes
token counting and more structured error codes that are absent from that published release.
The example therefore keeps its local token bridge. Verify the actual published package before
removing it; a version string on an upstream branch does not establish release availability.

Goliath recognizes wrapped `MODEL_UNAVAILABLE`, `UNSUPPORTED_OS`, and
`CONTEXT_WINDOW_EXCEEDED` codes when a provider supplies them. Safety refusals retain priority and
end on-device. Older unsafe-content messages are also recognized; unclassified errors remain
`model-error`. No new provider version is required for existing callers.

Sources: [published package metadata](https://registry.npmjs.org/@react-native-ai%2Fapple),
[upstream token API](https://github.com/callstackincubator/ai/blob/main/packages/apple-llm/src/AppleFoundationModels.ts),
[upstream errors](https://github.com/callstackincubator/ai/blob/main/packages/apple-llm/src/errors.ts).

## iOS 27 integration boundaries

These are future integration options, not capabilities enabled by Goliath's current Apple adapter:

- **Private Cloud Compute:** a candidate for an explicit `fallback`, once a native/provider adapter
  exists. It requires app eligibility and an entitlement, availability checks, internet access,
  and handling for quotas and rate limits. Keep it opt-in and report it as cloud execution.
  Preserve `beforeFallback` policy hooks and avoid replaying already-completed writes.
  [Apple's integration guide](https://developer.apple.com/documentation/foundationmodels/adding-server-side-intelligence-with-private-cloud-compute)
- **Images:** Apple supports image attachments, but the published provider and Goliath's `run(ask)`
  are text-only. Adoption needs typed attachments, image-aware budgeting, and explicit handling
  of images in memory and fallback. Do not encode image bytes into the text prompt.
  [Multimodal prompting](https://developer.apple.com/documentation/foundationmodels/analyzing-images-with-multimodal-prompting)
- **Dynamic Profiles:** native sessions can change models, tools, and instructions. Retaining such
  a session differs from Goliath's fresh-context execution. An adapter must preserve confirmation,
  cancellation, bounded history, and step observability before replacing that behavior.
  [Dynamic sessions](https://developer.apple.com/documentation/foundationmodels/composing-dynamic-sessions-with-instructions-and-profiles)

App Intents, widgets, Live Activities, and Liquid Glass belong in the consuming application's
integration/UI layer. They do not require changing the core harness. App actions should use the
same authorization and tool-execution rules as other entry points.
