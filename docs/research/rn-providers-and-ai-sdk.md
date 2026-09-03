# Goliath research brief: React Native on-device providers and the Vercel AI SDK

Date: 2026-09-02. Every version number below was read from the npm registry or the package's
published tarball on that date; every behavioural claim was read from the package source, not
from its README. Where README and source disagree, the source is cited and the disagreement noted.

## 0. Headline findings

1. **`@react-native-ai/apple` is the only Apple provider that (a) is an AI SDK provider and (b)
   registers JS tools with Apple's native `Tool` protocol.** Latest published: **0.12.0**
   (2026-01-28). It implements **`LanguageModelV3`** on `@ai-sdk/provider ^3.0.5`, i.e. the AI SDK
   **v6** spec. ([package.json](https://unpkg.com/@react-native-ai/apple@0.12.0/package.json),
   [npm](https://registry.npmjs.org/@react-native-ai%2Fapple))
2. **It works unchanged under `ai@7`.** `ai@7.0.91` declares
   `type LanguageModel = GlobalProviderModelId | LanguageModelV4 | LanguageModelV3 | LanguageModelV2`
   and its `resolveLanguageModel` accepts `"v4" | "v3" | "v2"`, wrapping a v3 model in a `Proxy`
   that only relabels `specificationVersion` to `"v4"` (a compatibility warning is logged for v2
   only). The V3 and V4 `LanguageModel` types are structurally identical apart from V4's optional
   `reasoning` call option and two new content types.
   ([ai@7 index.d.ts line 112](https://unpkg.com/ai@7.0.91/dist/index.d.ts),
   [ai@7 dist/index.js `resolveLanguageModel` / `asLanguageModelV4`](https://unpkg.com/ai@7.0.91/dist/index.js),
   [@ai-sdk/provider@4.0.10 index.d.ts](https://unpkg.com/@ai-sdk/provider@4.0.10/dist/index.d.ts))
3. **Apple runs the whole tool loop natively inside one `doGenerate`.** Tool calls and results come
   back as `providerExecuted: true` content parts with `toolCallId: ''` and `finishReason: 'stop'`;
   the AI SDK therefore sees exactly one step, so `stopWhen`, `prepareStep`, `onStepEnd` and
   tools-without-`execute` never engage. ([ai-sdk.ts](https://unpkg.com/@react-native-ai/apple@0.12.0/src/ai-sdk.ts),
   [generating.md](https://github.com/callstackincubator/ai/blob/main/website/src/docs/apple/generating.md))
4. **The JS `execute` runs on the JS thread via a JSI bridge while the Swift `Tool.call` is
   suspended on a `CheckedContinuation`.** The mechanism is a global registry
   `globalThis.__APPLE_LLM_TOOLS__[toolId]`, invoked from ObjC++ through
   `RCTCallInvoker->invokeAsync`, promise-aware. ([AppleLLM.mm](https://unpkg.com/@react-native-ai/apple@0.12.0/ios/AppleLLM.mm),
   [AppleLLMImpl.swift](https://unpkg.com/@react-native-ai/apple@0.12.0/ios/AppleLLMImpl.swift))
5. **Goliath cannot get a true step boundary from Apple's native tools** (Apple's `Tool.call` must
   return output or throw; there is no "stop here and hand the call to JS" path). One-step-at-a-time
   control needs the wrapper in §8: keep native tools for the fast path and add a
   _schema-emulated_ tool mode that turns Apple's guided generation into ordinary
   `finishReason: 'tool-calls'` steps the AI SDK loop understands.

---

## 1. `@react-native-ai/apple` (Callstack)

### 1.1 Versions, dependencies, AI SDK target

| Fact               | Value                                                                                                          | Source                                                                                                                                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Latest npm version | `0.12.0`, published 2026-01-28; `dist-tags: { latest: '0.12.0' }`                                              | [registry](https://registry.npmjs.org/@react-native-ai%2Fapple)                                                                                                                                                |
| Dependencies       | `@ai-sdk/provider ^3.0.5`, `@ai-sdk/provider-utils ^4.0.1`, `zod ^4.2.1`                                       | [package.json](https://unpkg.com/@react-native-ai/apple@0.12.0/package.json)                                                                                                                                   |
| Peer               | `react-native >=0.76.0` (dev-tested on 0.81.4)                                                                 | same                                                                                                                                                                                                           |
| AI SDK spec        | `LanguageModelV3`, `EmbeddingModelV3`, `TranscriptionModelV3`, `SpeechModelV3` (`specificationVersion = 'v3'`) | [ai-sdk.ts](https://unpkg.com/@react-native-ai/apple@0.12.0/src/ai-sdk.ts)                                                                                                                                     |
| Compat table       | "0.11 and below → AI SDK v5; 0.12 and above → v6"                                                              | [root README](https://github.com/callstackincubator/ai/blob/main/README.md)                                                                                                                                    |
| Stale text         | the package README still says "Vercel AI SDK v5"; the docs' getting-started says "v5+"                         | [README.md](https://unpkg.com/@react-native-ai/apple@0.12.0/README.md), [getting-started.mdx](https://github.com/callstackincubator/ai/blob/main/website/src/docs/apple/getting-started.mdx)                   |
| Repo               | `callstackincubator/ai`, 1,393 stars, 58 forks, last push 2026-07-07, `packages/apple-llm`                     | [GitHub API](https://api.github.com/repos/callstackincubator/ai)                                                                                                                                               |
| Downloads          | 70,908 / last month                                                                                            | [npm downloads API](https://api.npmjs.org/downloads/point/last-month/@react-native-ai/apple)                                                                                                                   |
| Example app        | Expo `~54.0.33`, RN `0.81.5`, `ai ^6.0.0`, `newArchEnabled: true`, `web-streams-polyfill ^4.1.0`               | [apps/expo-example/package.json](https://github.com/callstackincubator/ai/blob/main/apps/expo-example/package.json), [app.json](https://github.com/callstackincubator/ai/blob/main/apps/expo-example/app.json) |

**Unreleased on `main` (commits after the `v0.12.0` tag touching `packages/apple-llm`):**
`9e14139f` 2026-06-01 "graceful apple context window error handling, countTokens API" (#212),
`1aa15b25` 2026-06-03 "standardize apple llm error codes" (#213), `7610f448` 2026-07-06 lefthook.
`main`'s `package.json` still says `0.12.0`, so none of this is on npm.
([commits](https://api.github.com/repos/callstackincubator/ai/commits?path=packages/apple-llm&since=2026-01-28T00:00:00Z),
[tags](https://api.github.com/repos/callstackincubator/ai/tags)). Diffing `main` against the
tarball shows these `main`-only changes: `model.updateTools(tools)`, `AppleLLMErrorCodes` /
`AppleLLMError` (`MODEL_UNAVAILABLE`, `UNSUPPORTED_OS`, `GENERATION_ERROR`, `INVALID_MESSAGE`,
`CONFLICTING_SAMPLING_METHODS`, `INVALID_SCHEMA`, `TOOL_CALL_ERROR`, `UNKNOWN_TOOL_CALL_ERROR`,
`CONTEXT_WINDOW_EXCEEDED`), `AppleFoundationModels.countTokens(text)` (iOS 26.4 SDK),
stream ids generated in JS, `"null"` chunk filtering, `finally`-based tool-registry cleanup, and a
synthesized `ToolCallOptions` for `execute`. ([main ai-sdk.ts](https://github.com/callstackincubator/ai/blob/main/packages/apple-llm/src/ai-sdk.ts),
[main errors.ts](https://github.com/callstackincubator/ai/blob/main/packages/apple-llm/src/errors.ts),
[main AppleLLMImpl.swift](https://github.com/callstackincubator/ai/blob/main/packages/apple-llm/ios/AppleLLMImpl.swift))

### 1.2 Exact exported API (0.12.0)

`src/index.ts` exports: `apple`, `createAppleProvider`, `AppleEmbeddings`, `AppleFoundationModels`,
`AppleSpeech`, `VoiceInfo`, `AppleTranscription`, `AppleUtils`, `addWAVHeader`, `AudioFormatType`.
([index.ts](https://unpkg.com/@react-native-ai/apple@0.12.0/src/index.ts))

```ts
// API cheat sheet — @react-native-ai/apple@0.12.0, signatures transcribed from src/ai-sdk.ts
// and src/NativeAppleLLM.ts. "(main)" marks things only on the GitHub main branch.
import { apple, createAppleProvider, AppleFoundationModels } from "@react-native-ai/apple";
import type { Tool as ToolDefinition } from "@ai-sdk/provider-utils"; // the `tool({...})` object
import type {
  LanguageModelV3,
  EmbeddingModelV3,
  TranscriptionModelV3,
  SpeechModelV3,
} from "@ai-sdk/provider";

// ---- provider factory --------------------------------------------------------------------
function createAppleProvider(opts?: { availableTools?: Record<string, ToolDefinition> }): {
  (): LanguageModelV3; // apple()  → AppleLLMChatLanguageModel
  isAvailable(): boolean; // sync; SystemLanguageModel.default.availability == .available
  languageModel(): LanguageModelV3;
  textEmbeddingModel(o?: { language?: string }): EmbeddingModelV3; // NOTE: not `embeddingModel`
  transcriptionModel(o?: { language?: string }): TranscriptionModelV3; // SpeechTranscriber, iOS 26+
  speechModel(o?: { language?: string }): SpeechModelV3; // AVSpeechSynthesizer
  imageModel(): never; // throws 'Image generation models are not supported by Apple LLM'
};
const apple = createAppleProvider(); // default instance, NO tools registered

// ---- the language model ------------------------------------------------------------------
class AppleLLMChatLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3";
  readonly provider = "apple";
  readonly modelId = "system-default";
  readonly supportedUrls = {};
  prepare(): Promise<void>; // no-op
  updateTools(tools: Record<string, ToolDefinition>): void; // (main only)
  doGenerate(o: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult>;
  doStream(
    o: LanguageModelV3CallOptions,
  ): Promise<{ stream: ReadableStream<LanguageModelV3StreamPart>; rawCall }>;
}
// Call-option mapping inside doGenerate/doStream:
//   maxOutputTokens → maxTokens → GenerationOptions.maximumResponseTokens
//   temperature     → GenerationOptions.temperature
//   topP            → SamplingMode.random(probabilityThreshold: topP)
//   topK            → SamplingMode.random(top: topK)      (topP && topK → CONFLICTING_SAMPLING_METHODS)
//   neither         → SamplingMode.greedy (default)
//   responseFormat {type:'json', schema} → DynamicGenerationSchema → session.respond(schema:, includeSchemaInPrompt: true)
//   tools[]         → JSITool (native `Tool` protocol) per function tool; execute looked up in availableTools
//   abortSignal, stopSequences, seed, presence/frequencyPenalty, providerOptions → ignored (not read)

// ---- raw TurboModule (bypasses the AI SDK) ------------------------------------------------
interface AppleMessage {
  role: "assistant" | "system" | "tool" | "user";
  content: string;
}
interface AppleGenerationOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  schema?: object;
  tools?: object;
}
const AppleFoundationModels: {
  isAvailable(): boolean;
  generateText(
    messages: AppleMessage[],
    options: AppleGenerationOptions,
  ): Promise<
    Array<
      | { type: "text"; text: string }
      | { type: "tool-call"; toolName: string; input: string }
      | { type: "tool-result"; toolName: string; output: string }
    >
  >;
  generateStream(messages: AppleMessage[], options: AppleGenerationOptions): string; // returns streamId (main: (streamId, messages, options) => void)
  cancelStream(streamId: string): void;
  onStreamUpdate: EventEmitter<{ streamId: string; content: string }>; // content is the CUMULATIVE snapshot
  onStreamComplete: EventEmitter<{ streamId: string }>;
  onStreamError: EventEmitter<{ streamId: string; error: string }>; // (main adds code?: string)
  countTokens(text: string): Promise<number>; // (main only; iOS 26.4 SDK)
};
```

Sources: [ai-sdk.ts](https://unpkg.com/@react-native-ai/apple@0.12.0/src/ai-sdk.ts),
[NativeAppleLLM.ts](https://unpkg.com/@react-native-ai/apple@0.12.0/src/NativeAppleLLM.ts),
[AppleLLMImpl.swift `createGenerationOptions`](https://unpkg.com/@react-native-ai/apple@0.12.0/ios/AppleLLMImpl.swift).
Note the ai-sdk.dev community page writes `apple.embeddingModel()`; the shipped source only
defines `textEmbeddingModel` ([ai-sdk.dev page](https://ai-sdk.dev/providers/community-providers/react-native-apple)).

### 1.3 How tools are passed: native `Tool` protocol, JS `execute`, one-call round trip

**Registration.** `doGenerate` calls `prepareTools(options.tools)`: for each AI SDK function tool it
looks up `this.tools[tool.name]` (the `availableTools` given to `createAppleProvider`) and throws
`Tool ${name} not found` if absent; it then creates `{ ...tool, id: generateId(), execute }` and
stores `execute` at `globalThis.__APPLE_LLM_TOOLS__[id]` for the duration of the call
([ai-sdk.ts](https://unpkg.com/@react-native-ai/apple@0.12.0/src/ai-sdk.ts)). This is why the docs
say "Pre-register all tools: You must pass all tools to `createAppleProvider` upfront"
([generating.md](https://github.com/callstackincubator/ai/blob/main/website/src/docs/apple/generating.md)).

**Native side.** Swift `createTools(from:toolInvoker:)` builds one `JSITool: Tool` per definition
with `name`, `description`, `parameters: GenerationSchema` (parsed from the JSON Schema by
`AppleLLMSchemaParser`), and constructs
`LanguageModelSession(model: SystemLanguageModel.default, tools: tools, transcript: transcript)`.
`JSITool.call(arguments: GeneratedContent) async throws -> String` does
`withCheckedThrowingContinuation { invokeJavaScriptTool(toolId, String(describing: arguments)) { result, error in ... } }`
— a `String` result is returned as-is, any other object is `JSONSerialization`-encoded, `nil` →
`unknownToolCallError` ([AppleLLMImpl.swift](https://unpkg.com/@react-native-ai/apple@0.12.0/ios/AppleLLMImpl.swift)).

**The bridge.** ObjC++ `callToolWithId:arguments:completion:` runs
`[self.callInvoker callInvoker]->invokeAsync([...](jsi::Runtime& rt) { ... })`, reads
`rt.global().getPropertyAsObject(rt, "__APPLE_LLM_TOOLS__")`, calls the function with the raw
argument string, and if the result `hasProperty("then")` attaches host-function `resolve`/`reject`
callbacks; results are converted with `TurboModuleConvertUtils::convertJSIValueToObjCObject`.
The reject path produces the generic message "There was an error calling tool" (the JS error is
discarded) ([AppleLLM.mm](https://unpkg.com/@react-native-ai/apple@0.12.0/ios/AppleLLM.mm)).
So: **`execute` is your JS function, run on the JS thread, awaited by Apple's native tool loop.**

**Round trip.** Apple's framework "returns the tool's output back to the model for further
processing" inside the same `respond` call, and "if the model needs to pass the output of one tool
as the input to another, it executes back-to-back tool calls"
([Apple `Tool` docs](https://developer.apple.com/documentation/foundationmodels/tool)). After
`respond` resolves, `Response.toModelMessages()` flattens `transcriptEntries`:
`.response → {type:'text'}`, `.toolCalls → {type:'tool-call', toolName, input}`,
`.toolOutput → {type:'tool-result', toolName, output}`; the JS side re-emits these as
`{ type: 'tool-call', toolCallId: '', providerExecuted: true, ... }` and
`{ type: 'tool-result', toolCallId: '', providerExecuted: true, result }`, always with
`finishReason: { unified: 'stop' }` and all-zero `usage`
([AppleLLMImpl.swift `toModelMessages`](https://unpkg.com/@react-native-ai/apple@0.12.0/ios/AppleLLMImpl.swift),
[ai-sdk.ts](https://unpkg.com/@react-native-ai/apple@0.12.0/src/ai-sdk.ts)).

**Effect on the AI SDK loop.** `ai@7`'s `generateText` computes
`clientToolCalls = stepToolCalls.filter(toolCall => !toolCall.providerExecuted)` and continues the
`do … while` only when `clientToolCalls.length > 0 || pendingDeferredToolCalls.size > 0`
([ai@7 dist/index.js](https://unpkg.com/ai@7.0.91/dist/index.js)). With every Apple tool call marked
`providerExecuted`, the loop always ends after step 1. The Callstack docs state the same
consequence: "Tools are executed by Apple, not the Vercel AI SDK … `maxSteps`, `onStepStart`, and
`onStepFinish` will not be executed … Apple doesn't provide tool call IDs, so they will be empty
strings" ([generating.md](https://github.com/callstackincubator/ai/blob/main/website/src/docs/apple/generating.md)).
The ai-sdk.dev community page summarises it as "Multi-step features like `stopWhen` are
unsupported" ([ai-sdk.dev](https://ai-sdk.dev/providers/community-providers/react-native-apple)).

**Two source-level gotchas.**

- In 0.12.0 the JSI calls `tool.call(rt, args)` with a single argument, so the `opts` parameter
  of `execute(modelInput, opts)` is `undefined`; `toolDefinition.execute?.(args, opts)` therefore
  passes `undefined` as the AI SDK's `ToolCallOptions`. `main` synthesizes
  `{ toolCallId: generateId(), messages: [] }` instead
  ([diff main vs 0.12.0 ai-sdk.ts](https://github.com/callstackincubator/ai/blob/main/packages/apple-llm/src/ai-sdk.ts)).
- A tool without `execute` returns `undefined` → Swift `unknownToolCallError` → the whole
  generation fails. Native mode therefore **requires** every tool to have `execute`.

### 1.4 Prompt/message conversion (what can and cannot be fed back)

`prepareMessages` keeps only `text` parts (other parts trigger
`console.warn('Unsupported message content type:')` and are dropped), producing
`{ role, content: string }`. Swift `createTranscriptAndPrompt` then requires the **last message to
be `user`** (else `INVALID_MESSAGE`), maps `system → Transcript.Instructions(segments, toolDefinitions)`,
`user → Transcript.Prompt`, `assistant → Transcript.Response`, and **throws for any other role,
including `tool`** ([ai-sdk.ts](https://unpkg.com/@react-native-ai/apple@0.12.0/src/ai-sdk.ts),
[AppleLLMImpl.swift](https://unpkg.com/@react-native-ai/apple@0.12.0/ios/AppleLLMImpl.swift)).
Consequence: an AI SDK multi-step transcript (assistant `tool-call` parts + `tool` messages) cannot
be replayed through `apple()` as-is; a wrapper must render them to text first (§8). A new
`LanguageModelSession` is created **per call** from the rebuilt transcript — the provider is
stateless.

### 1.5 Structured output

`responseFormat.type === 'json'` forwards the JSON Schema to Swift, which builds a
`DynamicGenerationSchema` and calls `session.respond(to:schema:includeSchemaInPrompt: true, options:)`.
Supported: `object` (required/optional props, descriptions), `array` (`items`, `minItems`,
`maxItems`), `string` (`enum` → `GenerationGuide.anyOf`, `pattern` → `Regex` guide), `number` /
`integer` (`minimum`, `maximum`, `exclusiveMinimum/Maximum` approximated to inclusive; numeric
`enum` emitted as strings), `boolean`, `anyOf`. Unsupported: `multipleOf` (throws), any other
`type` (throws), and — per the docs — string formats and unions
([AppleLLMImpl.swift `AppleLLMSchemaParser`](https://unpkg.com/@react-native-ai/apple@0.12.0/ios/AppleLLMImpl.swift),
[generating.md](https://github.com/callstackincubator/ai/blob/main/website/src/docs/apple/generating.md)).
Works through `generateObject({ model: apple(), schema })` and `generateText({ ..., output: Output.object({ schema }) })`
(docs still show the v5/v6 `experimental_output` spelling; v7 renamed it to `output`
([migration guide](https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0))).
**Streaming JSON throws** `'Streaming JSON responses is not yet supported.'` in `doStream`.

### 1.6 Streaming

`doStream` requires a global `ReadableStream` (throws otherwise), emits `text-start`, then
`text-delta` per native `onStreamUpdate` (native sends the cumulative `chunk.content`; JS slices
off the previous length — `main` guards against non-prefix snapshots and drops literal `"null"`
chunks), then `text-end` + `finish` on `onStreamComplete`; errors become `{type:'error'}` parts.
`cancel()` calls `NativeAppleLLM.cancelStream(streamId)` → `Task.cancel()`. **Tool calls are still
executed natively during a stream but no `tool-input-*`/`tool-call`/`tool-result` stream parts are
emitted** ([ai-sdk.ts](https://unpkg.com/@react-native-ai/apple@0.12.0/src/ai-sdk.ts),
[AppleLLMImpl.swift](https://unpkg.com/@react-native-ai/apple@0.12.0/ios/AppleLLMImpl.swift)).
`doGenerate` ignores `abortSignal` entirely (no native cancel path for `generateText`).

### 1.7 Availability, errors, context window

- `apple.isAvailable()` is a synchronous boolean; there are no reason codes (contrast corasan, §4).
- Errors in 0.12.0: `reject("MODEL_UNAVAILABLE", ...)` for unavailable model; everything else is
  `reject("AppleLLM", error.localizedDescription)` ([AppleLLMImpl.swift](https://unpkg.com/@react-native-ai/apple@0.12.0/ios/AppleLLMImpl.swift),
  [AppleLLMError.swift](https://unpkg.com/@react-native-ai/apple@0.12.0/ios/AppleLLMError.swift)).
  `main` maps `LanguageModelSession.GenerationError.exceededContextWindowSize` to
  `CONTEXT_WINDOW_EXCEEDED` and documents that "the provider does not automatically estimate tokens,
  remove messages from your prompt, or retry" ([generating.md](https://github.com/callstackincubator/ai/blob/main/website/src/docs/apple/generating.md)).
- Apple: "context window of 4096 tokens per LanguageModelSession"; tool definitions, tool I/O,
  schemas and responses all count ([TN3193](https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window)).
  `maximumResponseTokens` only caps output and Apple warns strict limits "can lead to the model
  producing malformed results" ([GenerationOptions](https://developer.apple.com/documentation/foundationmodels/generationoptions)).
- `usage` is always zeros in both `doGenerate` and `doStream`; do not budget on it.

### 1.8 Installation in Expo

- **TurboModule (codegen), not Nitro**: `codegenConfig.name = 'NativeAppleLLM'`, `type: 'modules'`,
  iOS `modulesProvider` for `AppleLLM`, `AppleEmbeddings`, `AppleTranscription`, `AppleSpeech`,
  `AppleUtils`; JS uses `TurboModuleRegistry.getEnforcing` ([package.json](https://unpkg.com/@react-native-ai/apple@0.12.0/package.json),
  [NativeAppleLLM.ts](https://unpkg.com/@react-native-ai/apple@0.12.0/src/NativeAppleLLM.ts)).
- **No Expo config plugin** (no `app.plugin.js` in the tarball; the root README says "No additional
  linking needed … autolinked") ([tarball listing](https://unpkg.com/@react-native-ai/apple@0.12.0/?meta),
  [README](https://github.com/callstackincubator/ai/blob/main/README.md)).
- **New Architecture required** (README "Requirements", docs "React Native New Architecture -
  Required for native module functionality"). Not usable in Expo Go — needs a dev build.
- **Minimum versions**: RN `>=0.76.0` (peer). Podspec uses `min_ios_version_supported` (RN's
  default floor, 15.1 for RN 0.81) and gates every Foundation Models call behind
  `#if canImport(FoundationModels)` + `if #available(iOS 26, *)`, so the app builds for older
  targets and `isAvailable()` returns `false` there ([AppleLLM.podspec](https://unpkg.com/@react-native-ai/apple@0.12.0/AppleLLM.podspec),
  [AppleLLMImpl.swift](https://unpkg.com/@react-native-ai/apple@0.12.0/ios/AppleLLMImpl.swift)).
  Runtime: iOS 26+ with Apple Intelligence enabled ([README](https://unpkg.com/@react-native-ai/apple@0.12.0/README.md)).
  Build: Xcode 26 SDK; `main` (not 0.12.0) additionally needs the iOS 26.4 SDK (issue #227).
- **Polyfills** (AI SDK in RN): `@ungap/structured-clone` + `@stardazed/streams-text-encoding`
  (`structuredClone`, `TextEncoderStream`, `TextDecoderStream`) on Expo; add `web-streams-polyfill`
  (`ReadableStream`, `WritableStream`, `TransformStream`) on bare RN
  ([polyfills.mdx](https://github.com/callstackincubator/ai/blob/main/website/src/docs/polyfills.mdx),
  [ai-sdk.dev Expo guide](https://ai-sdk.dev/docs/getting-started/expo)).

### 1.9 Open issues on the tracker (2026-09-02)

- [#227](https://github.com/callstackincubator/ai/issues/227) (2026-08-12) `apple-llm` on `main`
  fails to compile with Xcode 26.2: `countTokens` uses `SystemLanguageModel.tokenCount(for:)`, an
  iOS 26.4 SDK symbol; `#available` cannot fix a missing SDK symbol.
- [#199](https://github.com/callstackincubator/ai/issues/199) (2026-03-04, `enhancement`) the AI
  SDK adapters do not forward `providerOptions` (filed against llama; the Apple adapter also never
  reads `providerOptions`).
- [#148](https://github.com/callstackincubator/ai/issues/148) (2025-11-05, `Blocked`) "Android
  equivalent of Apple Intelligence" — since answered in practice by `@react-native-ai/adk` (§2).
- [#98](https://github.com/callstackincubator/ai/issues/98) full-duplex speech;
  [#224](https://github.com/callstackincubator/ai/issues/224) streaming transcription;
  [#226](https://github.com/callstackincubator/ai/issues/226) MLC prebuilt mismatch.
- Historical context for the tool design: [#35](https://github.com/callstackincubator/ai/issues/35),
  [#65](https://github.com/callstackincubator/ai/issues/65) ("put tools on a global object only for
  the duration of the call"), [#66](https://github.com/callstackincubator/ai/issues/66) ("add tool
  calls to returned transcript"), [#99](https://github.com/callstackincubator/ai/issues/99)
  (`JSITool` conformance break on an Xcode beta).

---

## 2. `@react-native-ai/*` siblings — is there one interface for Android later?

There is no `@react-native-ai/google` or `@react-native-ai/mlkit`. The scope on npm today
([search](https://registry.npmjs.org/-/v1/search?text=@react-native-ai&size=30)) and the repo's
`packages/` dir ([contents](https://api.github.com/repos/callstackincubator/ai/contents/packages)):

| Package                                                  | Version / date      | What                                                                                                                                                                                                                                  | Tools                                                                                                                                                                                                                                                                                         | Downloads (30d) |
| -------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `@react-native-ai/adk`                                   | 0.12.1 / 2026-07-07 | **Android**: Google ADK; on-device **Gemini Nano** via ML Kit GenAI (`modelType: 'genai-nano'`) or cloud Gemini. Turbo module `NativeAdkEngine`. Requires `minSdkVersion 26`, New Arch, "Vercel AI SDK v6 `LanguageModelV3` provider" | "Tool calling bridged to JavaScript executors … the provider bridges execution to JavaScript while ADK orchestrates the agent loop natively"; same `globalThis.__ADK_TOOLS__` registry and `providerExecuted: true` parts; streaming emits `tool-input-*`/`tool-call` parts; real token usage | 3,468           |
| `@react-native-ai/llama`                                 | 0.12.0 / 2026-01-28 | llama.rn GGUF, iOS + Android                                                                                                                                                                                                          | **client-executed**: emits `{type:'tool-call'}` with `finishReason 'tool-calls'` → standard AI SDK loop                                                                                                                                                                                       | 6,584           |
| `@react-native-ai/mlc`                                   | 0.12.0              | MLC LLM runtime                                                                                                                                                                                                                       | —                                                                                                                                                                                                                                                                                             | 321             |
| `@react-native-ai/json-ui`, `@react-native-ai/dev-tools` | —                   | LLM-driven UI; Rozenite AI SDK profiler                                                                                                                                                                                               | —                                                                                                                                                                                                                                                                                             | —               |

Sources: [adk README](https://unpkg.com/@react-native-ai/adk@0.12.1/README.md),
[adk package.json](https://unpkg.com/@react-native-ai/adk@0.12.1/package.json),
[adk ai-sdk.ts on main](https://github.com/callstackincubator/ai/blob/main/packages/adk/src/ai-sdk.ts),
[llama ai-sdk.ts on main](https://github.com/callstackincubator/ai/blob/main/packages/llama/src/ai-sdk.ts),
[llama README](https://unpkg.com/@react-native-ai/llama@0.12.0/README.md),
[downloads](https://api.npmjs.org/downloads/point/last-month/@react-native-ai/adk).

Answer: yes, one interface — every Callstack package is a `LanguageModelV3` provider with the same
`createXProvider({ availableTools })` shape — **but tool semantics split in two families**:
Apple and ADK are _provider-executed_ (native loop, `providerExecuted: true`, single AI SDK step);
llama is _client-executed_ (AI SDK loop). Goliath's wrapper must normalise that (§8), and it can
then cover Gemini Nano on Android by swapping `apple()` for `adk()` under the same wrapper.
ADK's structured output is `responseMimeType` JSON only — "schema constraints not yet supported" —
so the emulated-tools mode (§8) is less reliable there than on Apple's guided generation.

---

## 3. `expo-ai-kit` (saidkaban)

| Fact        | Value                                                                                                                                                                                                                                                                           | Source                                                                                                                                                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Version     | 0.14.1, 2026-08-23; repo 81 stars, pushed 2026-08-23; 5,236 downloads/30d                                                                                                                                                                                                       | [npm](https://registry.npmjs.org/expo-ai-kit), [GitHub API](https://api.github.com/repos/saidkaban/expo-ai-kit)                                                                                                                                          |
| Native tech | Expo Modules (`requireNativeModule('ExpoAiKit')`, Swift + Kotlin), config plugin `app.plugin.js` (`speech`, `androidEmbeddings` flags), Expo SDK 54+, iOS 15.1+ library floor, Android API 26+                                                                                  | [ExpoAiKitModule.ts](https://github.com/saidkaban/expo-ai-kit/blob/main/src/ExpoAiKitModule.ts), [package.json](https://github.com/saidkaban/expo-ai-kit/blob/main/package.json), [README](https://github.com/saidkaban/expo-ai-kit/blob/main/README.md) |
| Backends    | Apple Foundation Models (iOS 26+), ML Kit Prompt API (Android), downloadable LiteRT-LM (Gemma 4, Qwen3, Phi-4), NLContextualEmbedding / EmbeddingGemma, SpeechAnalyzer / ML Kit speech                                                                                          | README                                                                                                                                                                                                                                                   |
| AI SDK      | `expo-ai-kit/ai` → `expoAiKit()` implementing `LanguageModelV3` (+ `EmbeddingModelV3`, `TranscriptionModelV3`); `@ai-sdk/provider ^3.0.0` as an _optional_ peer, type-only imports; source comment: "Implements the LanguageModelV3 spec (AI SDK 6; also accepted by AI SDK 7)" | [src/ai/index.ts](https://github.com/saidkaban/expo-ai-kit/blob/main/src/ai/index.ts)                                                                                                                                                                    |

**Apple sessions are opened without native tools.** `ios/ExpoAiKitModule.swift` creates
`LanguageModelSession(instructions: baseSystemPrompt)` and calls `session.respond(to: conversationPrompt, options:)`
/ `streamResponse(...)` with `GenerationOptions(temperature:, maximumResponseTokens:)`; there is no
`tools:` argument anywhere and the whole message history is flattened into one prompt
([ExpoAiKitModule.swift lines ~312, ~370](https://github.com/saidkaban/expo-ai-kit/blob/main/ios/ExpoAiKitModule.swift)).
(The vendored LiteRT-LM Swift has `Tool.swift`/`ToolManager.swift`, but the Apple path does not use them.)

**`src/tools.ts` — prompt-emulated tool calling** ([source](https://github.com/saidkaban/expo-ai-kit/blob/main/src/tools.ts)):

- `buildToolInstruction(tools)` appends to the system prompt: a list of `- name: description` +
  `arguments JSON Schema: {...}`, then "To call a tool, respond with ONLY a JSON object of this
  exact form and nothing else: `{"tool": "<tool name>", "arguments": { ... }}`", rules: "Call at
  most one tool per response", "`tool` must be exactly one of …", "If you do not need a tool,
  answer the user directly in plain text with no JSON", "After you receive a tool result, use it
  to answer; do not repeat the same call."
- `parseToolCall(text, toolNames)` → `{kind:'tool'|'unknown-tool'|'text'}` using `extractJson`
  (tolerates prose and ```json fences; accepts `arguments` or `args`).
- Repair prompts: `buildUnknownToolRepair(name, names)` and `buildToolArgsRepair(name, errors)`
  ("Respond again with ONLY the corrected {...} JSON — no prose, no markdown code fences").
- `formatToolResult(name, result)` → `Result of calling the tool "<name>":\n<json>` fed back **as a
  user turn**.
- The core loop `generateText(messages, { tools, maxSteps = 5, maxRepairAttempts = 2, systemPrompt, signal })`
  in `src/index.ts`: per step, an inner repair loop re-prompts on unknown tool / schema-invalid
  args (`validateAgainstSchema`) up to `maxRepairAttempts`, then throws `INFERENCE_FAILED`; a tool
  without `execute` ends with `finishReason: 'tool-calls'` (human-in-the-loop); thrown tool errors
  are fed back as `{ error }` ([src/index.ts](https://github.com/saidkaban/expo-ai-kit/blob/main/src/index.ts),
  [types.ts](https://github.com/saidkaban/expo-ai-kit/blob/main/src/types.ts)).

**The `expo-ai-kit/ai` provider** ([src/ai/index.ts](https://github.com/saidkaban/expo-ai-kit/blob/main/src/ai/index.ts),
[src/ai/convert.ts](https://github.com/saidkaban/expo-ai-kit/blob/main/src/ai/convert.ts)):

- `doGenerate` is **single-shot and client-executed**: converts `LanguageModelV3CallOptions` to its
  `LLMMessage[]` protocol (assistant `tool-call` parts re-rendered as the JSON envelope, `tool`
  role → user text via `formatToolResult`, `toolChoice: 'required' | tool` enforced by "prompt
  nudge" + `compatibility` warning), runs one `sendMessage`, and returns either
  `{type:'tool-call', toolCallId, toolName, input}` with `finishReason 'tool-calls'` or text with
  `'stop'`; `<think>` blocks become `reasoning` parts. So **`stopWhen`/`prepareStep` work** — the AI
  SDK owns the loop. Repair loops are _not_ in the provider.
- Per-call sampling (`temperature`, `topK`, `maxOutputTokens`, …) is reported as `unsupported`
  warnings — it is fixed at `setModel()`.
- `doStream` buffers the entire response when tools or JSON are requested ("the envelope must be
  parsed as a whole"), then emits `tool-input-start/delta/end` + `tool-call` + `finish`.
- `responseFormat: json` is prompt-instructed, not constrained (Apple's guided generation is not
  used); `usage` is all `undefined`; file/image parts throw `DEVICE_NOT_SUPPORTED`.

---

## 4. `react-native-foundation-models` (corasan, Nitro) and `expo-ai-runtime` (stewmore)

### 4.1 corasan

| Fact       | Value                                                                                                                                                                                                                                                                                                                                                                                                                                   | Source                                                                                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Version    | 0.1.3, 2026-08-06; repo 7 stars, pushed 2026-08-11; 379 downloads/30d                                                                                                                                                                                                                                                                                                                                                                   | [npm](https://registry.npmjs.org/react-native-foundation-models), [GitHub API](https://api.github.com/repos/corasan/react-native-foundation-models)  |
| Tech       | Nitro Modules: peer `react-native-nitro-modules >=0.36.5`, `nitrogen 0.36.5`, dev RN 0.86.2; iOS only; `zod ^4.3.5` dependency                                                                                                                                                                                                                                                                                                          | [package/package.json](https://github.com/corasan/react-native-foundation-models/blob/main/package/package.json)                                     |
| Nitro spec | `LanguageModelSessionFactory { create(config), isAvailable, availabilityStatus, contextSize? }`; `LanguageModelSession { respond(prompt): Promise<string>; streamResponse(prompt, onStream): Promise<string>; tokenCount(prompt): Promise<number>; wasContextReset }`; `ToolDefinition { name, description, arguments: AnyMap, handler: (args: AnyMap) => Promise<AnyMap> }`; config `{ instructions?, tools?, useCase?, guardrails? }` | [LanguageModelSession.nitro.ts](https://github.com/corasan/react-native-foundation-models/blob/main/package/src/specs/LanguageModelSession.nitro.ts) |
| JS API     | `new LanguageModelSession({...})`, `createTool({ name, description, arguments: z.object(...), handler })`, `checkFoundationModelsAvailability()` → `{ isAvailable, status: 'available'                                                                                                                                                                                                                                                  | 'unavailable.deviceNotEligible'                                                                                                                      | 'unavailable.appleIntelligenceNotEnabled' | 'unavailable.modelNotReady' | …, message, contextSize, modelFamily: '26.0-26.3' | '26.4+' }`, hooks `useLanguageModel`, `useStreamingResponse` | [README](https://github.com/corasan/react-native-foundation-models/blob/main/README.md), [LanguageModelSession.ts](https://github.com/corasan/react-native-foundation-models/blob/main/package/src/LanguageModelSession.ts) |

Tool bridging: Swift `HybridTool: Tool` holds `handler: (AnyMap) -> Promise<Promise<AnyMap>>` —
Nitro marshals the JS async function as a callback that returns a Promise of a Promise; `call`
awaits both and converts the `AnyMap` to `GeneratedContent`
([HybridTool.swift](https://github.com/corasan/react-native-foundation-models/blob/main/package/ios/HybridTool.swift)).
The session is **stateful natively** (`LanguageModelSession(model:tools:instructions:)` kept
alive; on `exceededContextWindowSize` it summarises the transcript into a fresh session and sets
`wasContextReset`), guards `sessionBusy`, exposes `useCase`/`guardrails`, and prepends a plain-text
tool list to the instructions ([HybridLanguageModelSession.swift](https://github.com/corasan/react-native-foundation-models/blob/main/package/ios/HybridLanguageModelSession.swift)).
`createTool` sanitises the Zod-emitted JSON Schema and rejects unsupported features early (unions,
patterns, formats, tuples, records, nullable-required) ([tool-utils.ts](https://github.com/corasan/react-native-foundation-models/blob/main/package/src/tool-utils.ts)).
Not an AI SDK provider; no structured-output API for responses; tool results must be objects.
Maturity: single author, 0.1.x, 7 stars.

### 4.2 stewmore `expo-ai-runtime` / `ExpoAI`

Announced 2026-06-21 ([blog](https://www.stewmore.dev/blog/announcing-expo-ai-runtime)). Packages:
`@stewmore/expo-ai-core` 0.7.1 (pure TS: `ExpoAI.getCapabilities()`, `generate()`, `stream()`,
`createSession()`, `generateObject()`, provider router, privacy metadata, normalised errors),
`@stewmore/expo-ai-apple-foundation-models` 0.7.2 (Swift, iOS 26+),
`@stewmore/expo-ai-android-aicore` 0.7.2 (Kotlin, Gemini Nano via ML Kit GenAI / AICore),
`@stewmore/expo-ai-cloud`, `-react`, `-evals`; all published 2026-06-23
([npm core](https://registry.npmjs.org/@stewmore/expo-ai-core), [apple](https://registry.npmjs.org/@stewmore/expo-ai-apple-foundation-models),
[android](https://registry.npmjs.org/@stewmore/expo-ai-android-aicore)). Repo
`stewartmoreland/expo-ai-runtime`: 0 stars, pushed 2026-09-02 ([GitHub API](https://api.github.com/repos/stewartmoreland/expo-ai-runtime)).
README: "It is intentionally _not_ an agent framework yet"; blog: "There is no memory system, no
tool-calling loop, and no RAG pipeline in version one." Custom native code → `npx expo prebuild`.
Not an AI SDK provider. Its value for Goliath is as a _reference_ for capability detection and an
Apple/Nano router, not as a dependency.

---

## 5. Vercel AI SDK v7 agent primitives (exact names, paths, versions)

**Versions (npm dist-tags, 2026-09-02).** `ai`: `latest 7.0.91`, `ai-v6 6.0.275`, `ai-v5 5.0.251`;
`@ai-sdk/provider`: `latest 4.0.10`, `ai-v6 3.0.15`; `@ai-sdk/provider-utils`: `latest 5.0.36`,
`ai-v6 4.0.50`; `@ai-sdk/react`: `4.0.94` / `3.0.278`
([ai](https://registry.npmjs.org/ai), [provider](https://registry.npmjs.org/@ai-sdk/provider),
[provider-utils](https://registry.npmjs.org/@ai-sdk/provider-utils)).
`ai@7` is ESM-only (`exports: { import: './dist/index.js' }`, no CJS) with `engines.node >= 22`;
`ai@6` still ships `dist/index.mjs` + CJS with `node >= 18` ([ai@7 package.json](https://unpkg.com/ai@7.0.91/package.json),
[ai@6 package.json](https://unpkg.com/ai@6.0.275/package.json)). Metro handles ESM, so the
engines field only matters for Node-side tooling.

**Exports from `'ai'` (7.0.91)** ([index.d.ts export list](https://unpkg.com/ai@7.0.91/dist/index.d.ts)):
`ToolLoopAgent` (also exported as `Experimental_Agent`), `ToolLoopAgentSettings`
(`Experimental_AgentSettings`), `Agent`, `isStepCount` (also exported as `stepCountIs`),
`hasToolCall`, `isLoopFinished`, `StopCondition`, `PrepareStepFunction`, `PrepareStepResult`,
`Output` (namespace with `object`, `array`, `choice`, `json`, `text`), `generateText`, `streamText`,
`generateObject`, `streamObject`, `tool`, `dynamicTool`, `wrapLanguageModel`,
`LanguageModelMiddleware`, `pruneMessages`, `createAgentUIStream(Response)`,
`UnsupportedModelVersionError`, `NoOutputGeneratedError`.
v7 renames (old names remain as aliases or deprecated): `stepCountIs → isStepCount`,
`system → instructions`, `onStepFinish → onStepEnd`, `onFinish → onEnd`, `experimental_output → output`,
`experimental_telemetry → telemetry` ([migration guide 7.0](https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0)).

**`ToolLoopAgent`** ([index.d.ts](https://unpkg.com/ai@7.0.91/dist/index.d.ts), [reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent)):

```ts
import { ToolLoopAgent, isStepCount, hasToolCall, Output } from "ai";
class ToolLoopAgent<CALL_OPTIONS, TOOLS extends ToolSet, RUNTIME_CONTEXT, OUTPUT> implements Agent {
  readonly version = "agent-v1";
  constructor(settings: ToolLoopAgentSettings); // LanguageModelCallOptions & RequestOptions & {
  //   id?, instructions?, allowSystemInMessages?, model: LanguageModel,
  //   tools?, toolChoice?, stopWhen?: StopCondition | StopCondition[],
  //   activeTools?, toolOrder?, output?, runtimeContext?, toolApproval?,
  //   prepareStep?, repairToolCall?, include?, telemetry?, callbacks... }
  generate(o: AgentCallParameters): Promise<GenerateTextResult>; // { prompt | messages, abortSignal?, timeout?, options?, ...callbacks }
  stream(o: AgentStreamParameters): Promise<StreamTextResult>;
}
```

Default stop condition is `isStepCount(20)`; `isStepCount(1)` runs exactly one step
([loop control docs](https://ai-sdk.dev/docs/agents/loop-control)).

**`StopCondition` / `PrepareStepFunction`** ([index.d.ts](https://unpkg.com/ai@7.0.91/dist/index.d.ts)):

```ts
type StopCondition<TOOLS, CTX> = (o: {
  steps: StepResult<TOOLS, CTX>[];
}) => PromiseLike<boolean> | boolean;
type PrepareStepFunction<TOOLS, CTX> = (o: {
  steps;
  stepNumber;
  model: LanguageModel;
  instructions;
  initialInstructions;
  messages: ModelMessage[];
  initialMessages;
  responseMessages;
  toolsContext;
  runtimeContext;
  experimental_sandbox?;
}) => PrepareStepResult | PromiseLike<PrepareStepResult>;
type PrepareStepResult =
  | ({
      model?;
      toolChoice?;
      activeTools?;
      toolOrder?;
      instructions?;
      system /*deprecated*/?;
      messages?;
      toolsContext?;
      runtimeContext?;
      experimental_sandbox?;
      providerOptions?;
    } & LanguageModelCallOptions)
  | undefined;
```

Loop continuation (verbatim from the bundle): `while (clientToolOutputs.length + deniedToolApprovalResponses.length === clientToolCalls.length && (clientToolCalls.length > 0 || pendingDeferredToolCalls.size > 0) && !await isStopConditionMet({ stopConditions, steps }))`
where `clientToolCalls = stepToolCalls.filter(toolCall => !toolCall.providerExecuted)`
([ai@7 dist/index.js](https://unpkg.com/ai@7.0.91/dist/index.js)). Docs restate it: the loop
continues on `finishReason 'tool-calls'` with executable tools; a tool without `execute` "returns
control to the caller" via `toolCalls` / `response.messages`; provider-executed tools do not
trigger another model call ([tools docs](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)).

**`LanguageModelV3` — what a custom provider must implement** ([@ai-sdk/provider@4.0.10 index.d.ts](https://unpkg.com/@ai-sdk/provider@4.0.10/dist/index.d.ts); identical text in 3.0.15):

```ts
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3ToolCall,
  LanguageModelV3FunctionTool,
} from "@ai-sdk/provider";
type LanguageModelV3 = {
  readonly specificationVersion: "v3";
  readonly provider: string;
  readonly modelId: string;
  supportedUrls: PromiseLike<Record<string, RegExp[]>> | Record<string, RegExp[]>; // {} = download/inline everything
  doGenerate(options: LanguageModelV3CallOptions): PromiseLike<LanguageModelV3GenerateResult>;
  doStream(options: LanguageModelV3CallOptions): PromiseLike<LanguageModelV3StreamResult>;
};
// CallOptions (subset): prompt: LanguageModelV3Prompt; maxOutputTokens?; temperature?; topP?; topK?; stopSequences?; seed?;
//   tools?: Array<LanguageModelV3FunctionTool | LanguageModelV3ProviderTool>; toolChoice?; responseFormat?: {type:'text'} | {type:'json', schema?, name?, description?};
//   abortSignal?; headers?; providerOptions?   (V4 adds reasoning?: 'none'|'minimal'|'low'|'medium'|'high'|'xhigh'|'provider-default')
type LanguageModelV3FunctionTool = {
  type: "function";
  name: string;
  description?: string;
  inputSchema: JSONSchema7;
  inputExamples?;
  strict?;
  providerOptions?;
};
type LanguageModelV3ToolCall = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input: string /* JSON text */;
  providerExecuted?: boolean;
  dynamic?: boolean;
  providerMetadata?;
};
type LanguageModelV3ToolResult = {
  type: "tool-result";
  toolCallId;
  toolName;
  result: JSONValue;
  isError?;
  preliminary?;
  dynamic?;
  providerMetadata?;
};
type LanguageModelV3GenerateResult = {
  content: LanguageModelV3Content[];
  finishReason: {
    unified: "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other";
    raw?: string;
  };
  usage;
  providerMetadata?;
  request?;
  response?;
  warnings: SharedV3Warning[];
};
// StreamPart union: 'stream-start'{warnings} | 'response-metadata' | 'text-start'/'text-delta'/'text-end'{id} | 'reasoning-*' |
//   'tool-input-start'{id,toolName} / 'tool-input-delta'{id,delta} / 'tool-input-end'{id} | ToolCall | ToolResult | ToolApprovalRequest |
//   File | Source | 'finish'{usage, finishReason} | 'raw' | 'error'
```

Prompt messages: `system {content: string}`, `user {content: (text|file)[]}`,
`assistant {content: (text|file|reasoning|tool-call|tool-result)[]}`, `tool {content: (tool-result|tool-approval-response)[]}`.
The V3→V4 diff is: `reasoning?` on call options; `LanguageModelV4CustomContent` and
`LanguageModelV4ReasoningFile` added to the content/stream unions; middleware spec `'v4'`. Nothing
required for Goliath changes.

**Middleware** ([index.d.ts](https://unpkg.com/ai@7.0.91/dist/index.d.ts), [docs](https://ai-sdk.dev/docs/ai-sdk-core/middleware)):

```ts
import { wrapLanguageModel } from 'ai'
import type { LanguageModelV4Middleware } from '@ai-sdk/provider'
wrapLanguageModel({ model: LanguageModelV2 | LanguageModelV3 | LanguageModelV4, middleware, modelId?, providerId? }): LanguageModelV4
type LanguageModelV4Middleware = { specificationVersion: 'v4'; overrideProvider?; overrideModelId?; overrideSupportedUrls?;
  transformParams?: ({ type: 'generate'|'stream', params, model }) => PromiseLike<CallOptions>;
  wrapGenerate?: ({ doGenerate, doStream, params, model }) => PromiseLike<GenerateResult>;
  wrapStream?:   ({ doGenerate, doStream, params, model }) => PromiseLike<StreamResult> }
```

`transformParams` + `wrapGenerate` are enough to (a) rewrite the prompt and tools before Apple
sees them and (b) rewrite the returned content — which is exactly the interception point Goliath
needs (§8).

**Note on the community-provider doc**: ai-sdk.dev's "custom providers" page now tells authors to
implement `LanguageModelV4` ([page](https://ai-sdk.dev/providers/community-providers/custom-providers)).
Implementing V3 stays valid for both `ai@6` and `ai@7` (§0.2); implementing V4 locks Goliath to
`ai@7`. Recommendation: implement V3 in the wrapper and let `ai@7` proxy it.

---

## 6. Bridging an async JS `execute` into Swift `Tool.call` — what Callstack does, what it would take otherwise

Apple's contract: `protocol Tool<Arguments, Output>: Sendable` with `name`, `description`,
`parameters: GenerationSchema`, `includesSchemaInInstructions` (default `true`), and
`@concurrent func call(arguments: Arguments) async throws -> Output`; errors thrown inside `call`
are wrapped in `LanguageModelSession.ToolCallError` and rethrown from `respond`
([Tool](https://developer.apple.com/documentation/foundationmodels/tool),
[call(arguments:)](<https://developer.apple.com/documentation/foundationmodels/tool/call(arguments:)>),
[ToolCallError](https://developer.apple.com/documentation/foundationmodels/languagemodelsession/toolcallerror)).
The framework may call tools concurrently and back-to-back within one `respond`.

**Callstack (TurboModule + JSI) — yes, it does it**, per §1.3: per-call ids → `globalThis.__APPLE_LLM_TOOLS__`
→ `RCTCallInvoker::invokeAsync` (schedules on the JS thread) → `jsi::Function::call` → detect
`then` → host-function `resolve`/`reject` → `completion(result, error)` →
`CheckedContinuation.resume`. Properties of this design: no events, no promise _map_ on the JS
side (the map lives on the native side implicitly in the closure); JS errors are flattened to
"There was an error calling tool"; results are coerced to `String` (JSON for objects);
`toolCallId` is not surfaced; it works while the JS runtime is alive (no headless support).

**corasan (Nitro) — also yes**, via Nitro's callback marshalling: a JS `async (args) => result`
becomes `(AnyMap) -> Promise<Promise<AnyMap>>` in Swift; no registry needed, and per-tool typed
errors (`ArgumentParsingError`, `ResponseParsingError`) survive the bridge.

**If Goliath had to build its own (Expo Modules or Nitro)**, the minimal correct shape is a
_promise map keyed by call id_:

1. Native keeps `[String: CheckedContinuation<String, Error>]` guarded by a lock.
2. `Tool.call` generates `callId`, stores the continuation, then `sendEvent("onToolCall", { callId, toolName, arguments })`
   (Expo `sendEvent`) or invokes a Nitro callback.
3. JS listener runs the AI SDK `execute`, then calls native `resolveToolCall(callId, resultJSON)` /
   `rejectToolCall(callId, message)` (`AsyncFunction` in Expo Modules), which resumes the continuation.
4. Cancellation: `Task.cancel()` on the generation task plus a sweep that resumes every pending
   continuation with `CancellationError`.
   Nitro is the simpler route (typed callbacks, no id plumbing); Expo Modules is the more Expo-native
   route (config plugin, `expo-module.config.json`). Either way this is ~150 lines of Swift; the hard
   parts are schema translation (JSON Schema → `DynamicGenerationSchema`, already done by both
   Callstack and corasan) and error mapping.

---

## 7. Comparison

|                                     | `@react-native-ai/apple`                                                                           | `expo-ai-kit`                                                   | `react-native-foundation-models`                                                      | `@stewmore/expo-ai-*`                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Version / date                      | 0.12.0 / 2026-01-28 (`main` ahead, unreleased)                                                     | 0.14.1 / 2026-08-23                                             | 0.1.3 / 2026-08-06                                                                    | 0.7.x / 2026-06-23                                     |
| Native tech                         | TurboModule (codegen) + JSI; no config plugin                                                      | Expo Modules + config plugin                                    | Nitro Modules                                                                         | Expo Modules                                           |
| Apple native `Tool` protocol        | **Yes** (`JSITool`), JS `execute` bridged                                                          | **No** — prompt-emulated envelope, JS loop                      | **Yes** (`HybridTool`), JS handler bridged                                            | No tools in v1                                         |
| Tool results round-trip in one call | Yes (Apple loop; `providerExecuted: true`, `toolCallId: ''`)                                       | No — one call per step (`finishReason 'tool-calls'`)            | Yes (stateful native session)                                                         | n/a                                                    |
| AI SDK provider                     | `LanguageModelV3` (+ embedding, transcription, speech)                                             | `LanguageModelV3` (+ embedding, transcription)                  | No                                                                                    | No                                                     |
| `stopWhen`/`prepareStep` engage     | No (single step)                                                                                   | Yes                                                             | n/a                                                                                   | n/a                                                    |
| Structured output                   | Guided generation (`DynamicGenerationSchema`), `generateObject`/`Output.object`; no streaming JSON | Prompt-instructed JSON + `extractJson`; buffered when streaming | Tool arguments only                                                                   | `generateObject` (JSON-schema validation/repair in TS) |
| Streaming                           | Text deltas only; cancel; no tool stream parts                                                     | Text deltas; buffered for tools/JSON                            | `streamResponse(prompt, onChunk)`                                                     | `ExpoAI.stream`                                        |
| Availability API                    | `isAvailable(): boolean`                                                                           | `isAvailable()` + model-management                              | `checkFoundationModelsAvailability()` with reason codes, `contextSize`, `modelFamily` | `getCapabilities()`                                    |
| Context/token tools                 | 4096 documented; `countTokens` on `main` (iOS 26.4)                                                | —                                                               | `tokenCount()` (26.4), auto-summarise on overflow                                     | —                                                      |
| Android                             | Sibling `@react-native-ai/adk` (Gemini Nano, same provider-executed tool model)                    | Yes (ML Kit Prompt API, LiteRT-LM)                              | No                                                                                    | Yes (`expo-ai-android-aicore`)                         |
| Maturity                            | 1,393 stars; 70.9k dl/30d; Callstack-maintained; last push 2026-07-07                              | 81 stars; 5.2k dl/30d; single author; active                    | 7 stars; 379 dl/30d; single author                                                    | 0 stars; new; "not an agent framework yet"             |
| Min iOS / RN                        | build iOS ≥ RN floor, runtime iOS 26; RN ≥ 0.76, New Arch                                          | iOS 15.1 lib, 26 for FM; Expo 54+                               | iOS 26; Nitro ≥ 0.36.5                                                                | iOS 26; prebuild                                       |

---

## 8. Recommendation for Goliath

### 8.1 Build on `@react-native-ai/apple`, pinned to a fork/patch of `main`

Reasons: it is the only maintained, AI-SDK-native, Apple-`Tool`-protocol provider with real
guided generation; it already runs under `ai@7` (§0.2); Callstack's `adk` gives Gemini Nano with
the _same_ provider factory shape for later; and the example app shows the intended Expo 54 /
New-Arch setup. Caveats to plan around: the published 0.12.0 lacks `updateTools`, stable error
codes, `CONTEXT_WINDOW_EXCEEDED`, and passes `undefined` as `ToolCallOptions`; `main` fixes all
four but does not compile on Xcode < 26.4 (#227). Practical path: depend on `main` via a git
tarball or `patch-package` the 0.12.0 JS for the `ToolCallOptions` bug, and vendor the
`countTokens` guard until #227 is fixed. Do **not** build on expo-ai-kit's Apple path (no native
tools, no guided generation) or on corasan (no AI SDK surface, 0.1.x, single author); do borrow
corasan's availability reasons and expo-ai-kit's prompt-conversion code.

### 8.2 The control problem, stated precisely

Apple's `Tool.call` must return an output or throw; there is no "defer" outcome. So with native
tools the model never yields a tool call to JS as a _step_ — JS is called _during_ generation.
Goliath therefore needs two modes behind one `LanguageModelV3`:

- **Native mode** (default; fastest, model was trained on Apple's tool format): tools go to Apple;
  Goliath's control lives _inside_ the `execute` bridge — policy checks, approval gates (the
  Swift continuation simply stays suspended while JS awaits the user), timeouts, tracing, and a
  budget guard that returns an error string to make the model wrap up. After the call, Goliath
  reconstructs steps from the ordered `tool-call`/`tool-result` parts. What it cannot do:
  change messages/tools/model between tool calls, persist a half-finished loop, or get
  `toolCallId`s from Apple (assign its own).
- **Emulated mode** (true one-step-at-a-time; needed for `prepareStep`, persisted HITL, tool sets
  that change per step, cross-provider parity with llama/expo-ai-kit): send **no** native tools;
  instead ask Apple for guided JSON whose schema is a union of the tools' input schemas plus a
  "final answer" branch. Apple's constrained decoding guarantees the envelope is schema-valid (the
  weakness of expo-ai-kit's prompt-only approach), and the wrapper converts the result into a
  standard `tool-call` part with `finishReason 'tool-calls'`, so `ToolLoopAgent`, `stopWhen`,
  `prepareStep`, tools-without-`execute`, and `toolApproval` all work unmodified.

### 8.3 Exact shape of the wrapper

```ts
// goliath-apple-model.ts — a LanguageModelV3 that wraps @react-native-ai/apple.
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3Prompt,
  LanguageModelV3FunctionTool,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import { generateId, type Tool as AiTool, type ToolCallOptions } from "@ai-sdk/provider-utils";
import { createAppleProvider } from "@react-native-ai/apple";

type Mode = "native" | "emulated";
type Interceptor = (
  call: { toolCallId: string; toolName: string; input: unknown },
  run: () => Promise<unknown>,
) => Promise<unknown>;

export class GoliathAppleModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const;
  readonly provider = "goliath.apple";
  readonly modelId = "system-default";
  readonly supportedUrls = {};
  constructor(
    private mode: Mode,
    private tools: Record<string, AiTool>,
    private intercept: Interceptor,
  ) {}

  async doGenerate(o: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    const fnTools = (o.tools ?? []).filter(
      (t): t is LanguageModelV3FunctionTool => t.type === "function",
    );
    const prompt = renderPromptToText(o.prompt); // §1.4: tool-call parts → JSON envelope text,
    // tool role → user text, ensure last message is user
    if (this.mode === "emulated" && fnTools.length > 0) {
      const schema = envelopeSchema(fnTools); // { anyOf: [ {tool:'a' (enum), arguments:<a.inputSchema>}, ..., {answer: string} ] }
      const inner = createAppleProvider()(); // no availableTools → nothing registered natively
      const r = await inner.doGenerate({
        ...o,
        prompt,
        tools: [],
        toolChoice: undefined,
        responseFormat: { type: "json", schema },
      });
      const text = r.content.find((p) => p.type === "text")?.text ?? "";
      const env = JSON.parse(text);
      if (env.tool) {
        return {
          ...r,
          content: [
            {
              type: "tool-call",
              toolCallId: generateId(),
              toolName: env.tool,
              input: JSON.stringify(env.arguments ?? {}),
            },
          ],
          finishReason: { unified: "tool-calls", raw: "tool-calls" },
        }; // ← AI SDK loop takes over
      }
      return { ...r, content: [{ type: "text", text: env.answer ?? "" }] };
    }

    // native mode: give Apple the real tools, but every execute goes through Goliath's interceptor
    const wrapped: Record<string, AiTool> = {};
    for (const t of fnTools) {
      const src = this.tools[t.name];
      wrapped[t.name] = {
        ...src,
        execute: (input: unknown, opts?: ToolCallOptions) =>
          this.intercept(
            { toolCallId: opts?.toolCallId ?? generateId(), toolName: t.name, input },
            () => src.execute!(input, opts ?? { toolCallId: generateId(), messages: [] }),
          ),
      };
    }
    const inner = createAppleProvider({ availableTools: wrapped })(); // 0.12.0: one provider per call; main: inner.updateTools(wrapped)
    const r = await inner.doGenerate({ ...o, prompt });
    // Apple returned providerExecuted tool-call/tool-result pairs with toolCallId '' — give them stable ids
    let i = 0;
    const ids: string[] = [];
    const content = r.content.map((p) =>
      p.type === "tool-call"
        ? { ...p, toolCallId: (ids[i++] = generateId()) }
        : p.type === "tool-result"
          ? { ...p, toolCallId: ids.shift() ?? generateId() }
          : p,
    );
    return { ...r, content };
  }

  async doStream(o: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
    if (this.mode === "emulated" && (o.tools?.length ?? 0) > 0) {
      // Apple cannot stream guided JSON (throws) → run doGenerate and replay as stream parts, expo-ai-kit style
      const r = await this.doGenerate(o);
      return { stream: replayAsStream(r) };
    }
    const inner = createAppleProvider({ availableTools: this.tools })();
    return inner.doStream({ ...o, prompt: renderPromptToText(o.prompt) });
  }
}
```

The outer loop is then plain AI SDK:

```ts
import { ToolLoopAgent, isStepCount, generateText } from 'ai'

// (a) let the SDK run the loop, one step at a time, tools executed by Goliath's interceptor
const agent = new ToolLoopAgent({ model: new GoliathAppleModel('emulated', tools, intercept), tools,
  stopWhen: isStepCount(1), prepareStep: ({ stepNumber, messages }) => ({ messages: prune(messages) }) })

// (b) or own the loop: declare tools WITHOUT execute so each generateText returns after one model call
let messages: ModelMessage[] = [...]
for (;;) {
  const r = await generateText({ model, tools: toolsWithoutExecute, messages, stopWhen: isStepCount(1) })
  messages.push(...r.response.messages)
  if (r.finishReason !== 'tool-calls') break
  for (const c of r.toolCalls) messages.push({ role: 'tool', content: [{ type: 'tool-result', toolCallId: c.toolCallId, toolName: c.toolName, output: { type: 'json', value: await runTool(c) } }] })
}
```

Design notes that follow directly from the sources:

- `renderPromptToText` is mandatory in both modes because `apple()` drops non-text parts and
  rejects the `tool` role (§1.4); copy expo-ai-kit's `convertCallOptions` rules (assistant
  `tool-call` → JSON envelope text; `tool` → user text; merge systems) ([convert.ts](https://github.com/saidkaban/expo-ai-kit/blob/main/src/ai/convert.ts)).
- Keep the envelope schema inside Apple's supported subset (§1.5): `anyOf` of objects, string
  `enum` for the tool name, no unions inside argument schemas, no `format`/`multipleOf`; validate
  tool `inputSchema`s at registration like corasan's `sanitizeSchema` ([tool-utils.ts](https://github.com/corasan/react-native-foundation-models/blob/main/package/src/tool-utils.ts)).
- Budget: 4,096 tokens per session, tool schemas included ([TN3193](https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window));
  `usage` from the provider is zero, so Goliath must estimate (≈3–4 chars/token per Apple) or use
  `countTokens` when on `main` + iOS 26.4; catch `CONTEXT_WINDOW_EXCEEDED` (main) and apply a
  sliding window in `prepareStep` — the provider will not do it for you.
- Prefer `ToolLoopAgent` from `ai@7.0.x` with the wrapper declared as V3; `wrapLanguageModel`
  returns a V4 and can host the same logic as middleware (`transformParams` for the prompt/schema
  rewrite, `wrapGenerate` for the result rewrite) if a class is unwanted.
- Android later: instantiate the same wrapper over `createAdkProvider({ modelType: 'genai-nano' })`
  — native mode maps 1:1 (ADK is also provider-executed and exposes real usage); emulated mode
  works but without schema constraints until ADK supports them ([adk README](https://unpkg.com/@react-native-ai/adk@0.12.1/README.md)).

### 8.4 What to verify on a device before committing

1. Emulated-mode reliability: does Apple's guided generation with an `anyOf` root choose the
   "answer" branch appropriately, or does the model over-call tools? (Apple's own guidance is that
   the native tool prompt is the trained path.) Compare against native mode on Goliath's evals.
2. Approval gating in native mode: how long a suspended `Tool.call` can wait before Apple times
   out or the session reports `concurrentRequests` / `rateLimited` ([GenerationError cases](https://developer.apple.com/documentation/foundationmodels/languagemodelsession/generationerror)).
3. Whether `Response.transcriptEntries` preserves tool-call ordering for parallel tool calls, since
   the wrapper pairs `tool-call`/`tool-result` by position.
