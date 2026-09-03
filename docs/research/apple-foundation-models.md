# Apple Foundation Models framework — engineering brief for Goliath

Researched 2026-09-02. Scope: the on-device `SystemLanguageModel` as exposed by the
`FoundationModels` framework on iOS/iPadOS/macOS/visionOS 26.x, with the iOS 27 (WWDC26)
changes called out where they alter a constraint. Every number is sourced; where Apple's own
sources disagree, both are given.

Naming note: iOS 26 throws `LanguageModelSession.GenerationError.*`. iOS 27 deprecates that
enum and splits it into `LanguageModelError.*` (model-level), `SystemLanguageModel.Error.*`
(on-device-only), and `LanguageModelSession.Error.*` (misuse). Both spellings are given below.
([GenerationError](https://developer.apple.com/documentation/foundationmodels/languagemodelsession/generationerror),
[LanguageModelError](https://developer.apple.com/documentation/foundationmodels/languagemodelerror),
[Updates](https://developer.apple.com/documentation/updates/foundationmodels))

## Hard numbers at a glance

| Quantity                                       | Value                                                                                                                                             | Source                                                                                                                                                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Context window, on-device, iOS 26.0–26.4       | **4,096 tokens** per session, input + output combined, fixed                                                                                      | [TN3193](https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window), [DTS forum reply](https://developer.apple.com/forums/thread/806542)                                                   |
| Context window, on-device, iOS 27.0            | 4,096 on the iOS 26-class model; **8,192 on "newer devices"** (`contextSize` reports it)                                                          | [WWDC26 319](https://developer.apple.com/videos/play/wwdc2026/319/), [WWDC26 241](https://developer.apple.com/videos/play/wwdc2026/241/)                                                                                                             |
| Context window, Private Cloud Compute (iOS 27) | 32,768 tokens                                                                                                                                     | [WWDC26 319](https://developer.apple.com/videos/play/wwdc2026/319/)                                                                                                                                                                                  |
| Token ≈ characters                             | 3–4 chars (English/Latin); ~1 char (Chinese, Japanese, Korean, Vietnamese)                                                                        | [TN3193](https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window), [Managing the context window](https://developer.apple.com/documentation/foundationmodels/managing-the-context-window) |
| `maximumResponseTokens` default                | `nil` → "the longest answer its context size supports"; when set, the response is cut off early **without** an error                              | [maximumResponseTokens](https://developer.apple.com/documentation/foundationmodels/generationoptions/maximumresponsetokens)                                                                                                                          |
| `temperature` range                            | 0…1 inclusive per the API doc; `nil` = system default. (WWDC25 301 shows `temperature: 2.0` as "high-variance" — the doc is the stricter source.) | [temperature](https://developer.apple.com/documentation/foundationmodels/generationoptions/temperature), [WWDC25 301](https://developer.apple.com/videos/play/wwdc2025/301/)                                                                         |
| Sampling modes                                 | `.greedy`, `.random(top:seed:)`, `.random(probabilityThreshold:seed:)`; default is random                                                         | [SamplingMode](https://developer.apple.com/documentation/foundationmodels/generationoptions/samplingmode), [WWDC25 301](https://developer.apple.com/videos/play/wwdc2025/301/)                                                                       |
| Max tools                                      | No API limit; Apple: **"a maximum of 3–5 tools"**                                                                                                 | [TN3193](https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window)                                                                                                                        |
| Tool definition cost (measured)                | 68 tokens for one small tool; 16 tokens for a one-line instruction; 14 for a short prompt                                                         | [Novichkov](https://artemnovichkov.com/blog/tracking-token-usage-in-foundation-models)                                                                                                                                                               |
| Prompt/instruction length                      | "Aim for a maximum of 1–3 paragraphs"                                                                                                             | [TN3193](https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window)                                                                                                                        |
| Few-shot examples                              | "less than five"                                                                                                                                  | [WWDC25 248](https://developer.apple.com/videos/play/wwdc2025/248/)                                                                                                                                                                                  |
| Model size                                     | ~3 B parameters, 2-bit weights (QAT), 4-bit embeddings, 8-bit KV cache                                                                            | [WWDC25 286](https://developer.apple.com/videos/play/wwdc2025/286/), [Apple ML 2025](https://machinelearning.apple.com/research/apple-foundation-models-2025-updates)                                                                                |
| Throughput (Apple, 2024 model, iPhone 15 Pro)  | TTFT ≈ 0.6 ms per prompt token; ~30 tok/s                                                                                                         | [Apple ML 2024](https://machinelearning.apple.com/research/introducing-apple-foundation-models)                                                                                                                                                      |
| Requests per session                           | 1 in flight; a second throws `concurrentRequests`                                                                                                 | [Generating content](https://developer.apple.com/documentation/foundationmodels/generating-content-and-performing-tasks-with-foundation-models)                                                                                                      |
| Sessions per app                               | Unlimited; inference is serialized on the Neural Engine                                                                                           | [DTS forum reply](https://developer.apple.com/forums/thread/798113)                                                                                                                                                                                  |
| Rate limit                                     | Only when the app is in the **background**                                                                                                        | [rateLimited](<https://developer.apple.com/documentation/foundationmodels/languagemodelsession/generationerror/ratelimited(_:)>)                                                                                                                     |
| `prewarm` lead time                            | Only useful with ≥1 s before `respond`                                                                                                            | [prewarm](<https://developer.apple.com/documentation/foundationmodels/languagemodelsession/prewarm(promptprefix:)>)                                                                                                                                  |
| Devices                                        | iPhone 15 Pro/Pro Max, iPhone 16 and later; iPad mini (A17 Pro), M1+ iPads; Apple silicon Macs; Vision Pro                                        | [Apple support](https://support.apple.com/en-us/121115)                                                                                                                                                                                              |
| Languages                                      | 16 languages / 23 locales; check `supportedLanguages` at runtime                                                                                  | [Apple support](https://support.apple.com/en-us/121115), [Riyam](https://rudrank.com/exploring-foundation-models-supported-languages-internationalization)                                                                                           |
| Adapter                                        | LoRA rank 32, ~160 MB each, one per OS model version, entitlement to ship                                                                         | [Adapter toolkit](https://developer.apple.com/apple-intelligence/foundation-models-adapter/), [Apple ML 2025](https://machinelearning.apple.com/research/apple-foundation-models-2025-updates)                                                       |
| Model versions in the wild                     | 3: iOS 26.0–26.3, iOS 26.4, iOS 27.0                                                                                                              | [SystemLanguageModel](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel)                                                                                                                                                |

## 1. Context window

**Size.** "The on-device foundation model currently has a context window of 4096 tokens per
language model session, and all the input and response in the generation process contribute
tokens to the context window" (Ziqiao Chen, Apple WWDR). A DTS engineer on the same thread:
"This is always the fixed token limit, there's no possibility of it changing" and "the
tokenizer will always produce the same amount of tokens given the same input."
([forum 806542](https://developer.apple.com/forums/thread/806542)). The framework docs say the
same: "up to 4,096 tokens" ([Generating content](https://developer.apple.com/documentation/foundationmodels/generating-content-and-performing-tasks-with-foundation-models)).
The model was _trained_ on sequences up to 65K tokens, but that is not the deployed window
([Apple ML 2025](https://machinelearning.apple.com/research/apple-foundation-models-2025-updates)).

iOS 27 changes the picture only on newer hardware: the PCC session states "On-device model: 4K
tokens (26.0), 8K tokens on newer devices (27.0)", and the WWDC26 overview prints
`model.contextSize // 8192` ([WWDC26 319](https://developer.apple.com/videos/play/wwdc2026/319/),
[WWDC26 241](https://developer.apple.com/videos/play/wwdc2026/241/)). Third-party reporting puts
the 8K/"Core Advanced" tier on iPhone Air / 17 Pro and M4-class (or M3+ with 12 GB) Macs and
iPads ([ChatForest](https://chatforest.com/builders-log/apple-foundation-models-ios-27-on-device-llm-api-builder-guide/)) — treat that device list as unverified against Apple. Never hard-code either number: read `SystemLanguageModel.contextSize` (back-deployed to 26.0) ([contextSize](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel/contextsize)).

**What counts.** TN3193 enumerates everything that consumes the window: instructions, all
prompts, "information of tools (schemas, input, and output)", Generable schemas, and all model
responses ([TN3193](https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window)). The `Tool` doc: "Prompting the model with tools contributes to the available context window size. When you provide a tool in your generation request, the framework puts the tool definitions — name, description, parameter information — in the prompt" ([Tool](https://developer.apple.com/documentation/foundationmodels/tool)). Apple confirmed in a Q&A that both the tool description and the tool's response are counted ([Gubarenko Q&A](https://antongubarenko.substack.com/p/ios-26-foundation-model-framework-f6d)). `@Generable` and `@Guide` descriptions are also injected: "long descriptions take up additional context size and can introduce latency" ([Guided generation](https://developer.apple.com/documentation/foundationmodels/generating-swift-data-structures-with-guided-generation)).

**Error.** iOS 26: `LanguageModelSession.GenerationError.exceededContextWindowSize(Context)` — "An error that signals the session reached its context window size limit" ([GenerationError](https://developer.apple.com/documentation/foundationmodels/languagemodelsession/generationerror)). iOS 27: `LanguageModelError.contextSizeExceeded(_:)` ([LanguageModelError](https://developer.apple.com/documentation/foundationmodels/languagemodelerror)). The debug string reads like "Content contains 9056 tokens, which exceeds the maximum allowed context size of 4096" — and it can fire with the input under 4096 ("Content contains 4092 tokens…") because the model has no room left to generate ([forum 800238](https://developer.apple.com/forums/thread/800238)). Once thrown, "the session won't be able to respond" ([TN3193](https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window)). There is no automatic fallback to PCC or a cloud model on overflow ([forum 813557](https://developer.apple.com/forums/thread/813557)).

**Recovery.** Start a new session. To keep state, either summarize the old `transcript` into the
new session's prompt, or rehydrate a `Transcript` from a subset of entries. Apple's own example
keeps the first entry (instructions) and the last, then calls `prewarm()`:

```swift
func newContextualSession(with originalSession: LanguageModelSession) -> LanguageModelSession {
    let allEntries = originalSession.transcript
    let condensedEntries = [allEntries.first, allEntries.last].compactMap { $0 }
    let condensedTranscript = Transcript(entries: condensedEntries)
    let newSession = LanguageModelSession(transcript: condensedTranscript)
    newSession.prewarm()
    return newSession
}
```

([TN3193](https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window), [WWDC25 301](https://developer.apple.com/videos/play/wwdc2025/301/)). "The session's transcript includes the initial instructions as the first entry" ([WWDC25 301](https://developer.apple.com/videos/play/wwdc2025/301/)).

**Measuring.** iOS 26.4 added `SystemLanguageModel.tokenCount(for:)` (accepts instructions,
prompts, tools, schemas, transcript entries) and `contextSize`, both `@backDeployed(before: iOS 26.4)` so they work on 26.0+ ([Updates](https://developer.apple.com/documentation/updates/foundationmodels), [InfoQ](https://infoq.com/news/2026/03/apple-foundation-models-context), [Novichkov](https://artemnovichkov.com/blog/tracking-token-usage-in-foundation-models)). The Xcode Foundation Models Instrument shows per-request token counts ([TN3193](https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window)). iOS 27 adds `response.usage.input.totalTokenCount / cachedTokenCount` and `output.totalTokenCount / reasoningTokenCount`, plus `session.usage` accumulated ([WWDC26 241](https://developer.apple.com/videos/play/wwdc2026/241/), [LanguageModelSession](https://developer.apple.com/documentation/foundationmodels/languagemodelsession)). Before 26.4, the only counter was the error message; one production write-up used a 70% heuristic threshold to trigger summarization for that reason ([zats.io](https://zats.io/blog/making-the-most-of-apple-foundation-models-context-window/)).

## 2. Model class, quantization, speed, task fit

**Size.** "The on-device model … is a large language model with 3 billion parameters, each
quantized to 2 bits" ([WWDC25 286](https://developer.apple.com/videos/play/wwdc2025/286/)). The
2025 research post details it: ~3 B params, split into two blocks at a 5:3 depth ratio with KV
cache sharing (37.5% less KV memory, faster TTFT); weights 2 bpw via quantization-aware training,
embedding table 4 bpw, KV cache 8 bpw, with low-rank adapters trained to recover quantization
loss ([Apple ML 2025](https://machinelearning.apple.com/research/apple-foundation-models-2025-updates)). A third-party teardown of the shipped weights reports 3.18 B parameters and a ~1 GB footprint ([fguzman82](https://github.com/fguzman82/apple-foundation-model-analysis)). iOS 27 introduces "AFM 3 Core" (3 B dense) and "AFM 3 Core Advanced" (20 B sparse, 1–4 B active per prompt) on top-tier silicon ([Apple ML 2026](https://machinelearning.apple.com/research/introducing-third-generation-of-apple-foundation-models)).

**Speed.** Apple's only published on-device figures are for the 2024 model on iPhone 15 Pro:
"time-to-first-token latency of about 0.6 millisecond per prompt token, and a generation rate of
30 tokens per second" ([Apple ML 2024](https://machinelearning.apple.com/research/introducing-apple-foundation-models)). Developers report 30–50 tok/s on iPhone 15 Pro-class hardware, dropping when another Neural Engine workload runs ([HackerNoon](https://hackernoon.com/a-developers-guide-to-apples-foundation-models-framework-in-ios-26)). Cold start is "one-to-two-second" on the first request ([Drobinin](https://drobinin.com/consulting/foundation-models-apple-intelligence/putting-apple-foundation-models-in-a-real-app/)). Apple: "Each token in your instructions and prompt adds extra latency. Before the model can start producing response tokens, it first needs to process all the input tokens" ([WWDC25 301](https://developer.apple.com/videos/play/wwdc2025/301/)). Rule of thumb from these numbers: a full 4K prompt costs ~2.5 s before the first output token, and a 500-token answer another ~15 s.

**Good at** (Apple's list): summarize, extract entities, understand text, refine/edit text,
classify or judge text, compose creative writing, generate tags, generate game dialog. **Avoid**:
basic math, code, logical reasoning ([Generating content](https://developer.apple.com/documentation/foundationmodels/generating-content-and-performing-tasks-with-foundation-models)).
"It's not designed for world knowledge or advanced reasoning, which are tasks you might
typically use server-scale LLMs for" and "Device scale models require tasks to be broken down
into smaller pieces" ([WWDC25 286](https://developer.apple.com/videos/play/wwdc2025/286/)). "The
model won't know about recent events… it may hallucinate" and "Non-AI code is much more reliable
for math" ([WWDC25 248](https://developer.apple.com/videos/play/wwdc2025/248/)). In production
the model "will invent numbers" when fed unstructured data unless output is constrained
([Drobinin](https://drobinin.com/consulting/foundation-models-apple-intelligence/putting-apple-foundation-models-in-a-real-app/)).
Apple's own benchmark places it "favorably against the slightly larger Qwen-2.5-3B … competitive
against the larger Qwen-3-4B and Gemma-3-4B in English" ([Apple ML 2025](https://machinelearning.apple.com/research/apple-foundation-models-2025-updates)).

## 3. Tool calling

**Protocol.** `Tool` requires `name: String`, `description: String`, an `Arguments` associated
type conforming to `ConvertibleFromGeneratedContent` (in practice a `@Generable` struct), an
`Output` conforming to `PromptRepresentable` (String, `GeneratedContent`, or any `@Generable`),
and `func call(arguments:) async throws -> Output`. Tools must be `Sendable`. Optional
`parameters` (schema) and `includesSchemaInInstructions` ([Tool](https://developer.apple.com/documentation/foundationmodels/tool)). Tools are passed at session init and "will be available to the model for the session's lifetime" ([WWDC25 286](https://developer.apple.com/videos/play/wwdc2025/286/)); iOS 27 `DynamicProfile` lets the active tool set change mid-session ([WWDC26 241](https://developer.apple.com/videos/play/wwdc2026/241/)).

**How the model decides.** "A tool includes a name and a description that the framework puts in
the prompt to let the model decide when and how often to call your tool" ([Tool](https://developer.apple.com/documentation/foundationmodels/tool)). The model first generates the arguments via guided generation, then the framework invokes `call`; "the session waits for your tool to return, before it can generate any further output"; the output "is then put in the transcript, just like output from the model" ([WWDC25 301](https://developer.apple.com/videos/play/wwdc2025/301/)).

**Multiple calls, parallelism, loops — all inside one `respond`.** "If the model deems that
calling a tool can enhance the response, it will produce one or more tool calls" ([WWDC25 286](https://developer.apple.com/videos/play/wwdc2025/286/)). "The model can call a tool multiple times in parallel to satisfy the request, like when retrieving weather details for several cities" ([Tool calling article](https://developer.apple.com/documentation/foundationmodels/expanding-generation-with-tool-calling)); "when that happens, your tool gets called in parallel. So keep that in mind when accessing data from your tool's call method" ([WWDC25 301](https://developer.apple.com/videos/play/wwdc2025/301/)). Serial chaining also happens: "If the model needs to pass the output of one tool as the input to another, it executes back-to-back tool calls" ([Tool](https://developer.apple.com/documentation/foundationmodels/tool)); "the framework automatically and optimally handles the potentially complex call graphs of parallel and serial tool calls" ([Apple ML 2025](https://machinelearning.apple.com/research/apple-foundation-models-2025-updates)). The developer gets no hook between iterations — the loop is opaque until `respond` returns, except that each call lands in the observable `transcript` ([Tool calling article](https://developer.apple.com/documentation/foundationmodels/expanding-generation-with-tool-calling)). Since iOS 26.1 (beta at the time) a tool can read the session transcript from inside `call` ([Gubarenko Q&A](https://antongubarenko.substack.com/p/ios-26-foundation-model-framework-f6d)).

**iOS 27 control.** `GenerationOptions.toolCallingMode`: `.allowed` (default), `.required`
("must call one or more tools before it can respond"), `.disallowed`. With `.required` "you must
define an exit condition by either throwing an error from a tool's `call` … or by changing the
mode dynamically using a `DynamicProfile`; otherwise, the model continues to call the tool"
([Tool calling article](https://developer.apple.com/documentation/foundationmodels/expanding-generation-with-tool-calling)).

**Limits and guidance.** No API cap on tool count, but "Give the model a maximum of 3–5 tools
to choose from"; "Keep your tool description and @Guide descriptions to a short phrase each";
"Skip tool calling entirely when possible … In cases where the model should always have
information from a tool, run the tool directly before you call the model and integrate the
tool's output directly into the prompt"; if the window is tight, split argument generation and
output processing across two sessions ([TN3193](https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window)). Names: "consider using a verb in the name, such as findContact. And your description should be about one sentence" ([WWDC25 301](https://developer.apple.com/videos/play/wwdc2025/301/)). Structured output _from_ a multi-tool turn is a known gap — Apple's answer to "return OutA or OutB depending on which tool ran" was a side-channel workaround (tools write to a shared object) ([forum 811381](https://developer.apple.com/forums/thread/811381)). Tool calls occasionally "silently never execute despite proper registration" in the field ([Drobinin](https://drobinin.com/consulting/foundation-models-apple-intelligence/putting-apple-foundation-models-in-a-real-app/)).

**Errors.** A throwing tool surfaces as `LanguageModelSession.ToolCallError` carrying the tool
and underlying error. "When errors are thrown from a tool, the framework rolls back the
transcript to a previously known valid state"; iOS 27 `transcriptErrorHandlingPolicy` chooses
preserve vs revert. Alternatively return a short string like "Cannot access the database." so the
model can carry on ([Tool calling article](https://developer.apple.com/documentation/foundationmodels/expanding-generation-with-tool-calling)).

## 4. Guided generation

`@Generable` on structs, actors, enums (including enums with associated values); `@Guide` on
stored properties only. Primitives: `Bool`, `Int`, `Float`, `Double`, `Decimal`, `String`,
arrays, nested Generable types, recursive types ([Guided generation](https://developer.apple.com/documentation/foundationmodels/generating-swift-data-structures-with-guided-generation), [WWDC25 286](https://developer.apple.com/videos/play/wwdc2025/286/)). Guides shown by Apple: `description`, `.range(0...20)`, `.count(3)`, `maximumCount(_:)`, `anyOf` (dynamic) ([WWDC25 301](https://developer.apple.com/videos/play/wwdc2025/301/), [TN3193](https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window)).

**Guarantee.** "Guided Generation fundamentally guarantees structural correctness using a
technique called constrained decoding" — "For every token that's generated, there's a
distribution of all the tokens in the model's vocabulary. And constrained decoding works by
masking out the tokens that are not valid" ([WWDC25 286](https://developer.apple.com/videos/play/wwdc2025/286/), [WWDC25 301](https://developer.apple.com/videos/play/wwdc2025/301/)). The guarantee is structural, not semantic; `decodingFailure` still exists for the rare case the output cannot be deserialized ([GenerationError](https://developer.apple.com/documentation/foundationmodels/languagemodelsession/generationerror)). Properties generate "in the order they're declared" — put fields the model should reason about first ([Guided generation](https://developer.apple.com/documentation/foundationmodels/generating-swift-data-structures-with-guided-generation)).

**Depth limits.** Apple publishes no numeric nesting limit. Its advice is cost-based: "Reduce
the size and complexity of your type (think about how much screen space your @Generable code
takes)"; short property names; add `@Guide` only after trying without ([TN3193](https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window)). Unsupported guide patterns throw `unsupportedGuide` (26) / `unsupportedGenerationGuide` (27) ([GenerationError](https://developer.apple.com/documentation/foundationmodels/languagemodelsession/generationerror), [LanguageModelError](https://developer.apple.com/documentation/foundationmodels/languagemodelerror)).

**Streaming.** `streamResponse` yields `PartiallyGenerated` snapshots (all properties optional,
filled in as generation proceeds) rather than deltas ([WWDC25 286](https://developer.apple.com/videos/play/wwdc2025/286/)).

**Runtime schemas.** `DynamicGenerationSchema` initializers: `(name:description:properties:)`,
`(name:description:anyOf:)`, `(arrayOf:minimumElements:maximumElements:)`, `(referenceTo:)`,
`(type:guides:)`, `.null`. Schemas reference each other by name; `GenerationSchema(root:dependencies:)`
validates and throws on "conflicting property names, undefined references, or duplicate types".
Results come back as `GeneratedContent`; read with `value(_:forProperty:)` ([DynamicGenerationSchema](https://developer.apple.com/documentation/foundationmodels/dynamicgenerationschema), [Guided generation](https://developer.apple.com/documentation/foundationmodels/generating-swift-data-structures-with-guided-generation)). This is the path a JS-defined tool/schema layer must use — a JSON-schema-to-`DynamicGenerationSchema` translator at the bridge.

## 5. Sessions

- **State.** "A LanguageModelSession is stateful. Each respond(to:) call is recorded in the transcript" ([WWDC25 301](https://developer.apple.com/videos/play/wwdc2025/301/)). `transcript: Transcript` is readable and observable; `Transcript.Entry` kinds are instructions, prompt, toolCalls, toolOutput, response, and (27) reasoning ([LanguageModelSession](https://developer.apple.com/documentation/foundationmodels/languagemodelsession), [WWDC26 339](https://developer.apple.com/videos/play/wwdc2026/339/)). `init(model:tools:transcript:)` rehydrates a session from any transcript you construct ([LanguageModelSession](https://developer.apple.com/documentation/foundationmodels/languagemodelsession)).
- **Single flight.** "A session can only handle a single request at a time, and causes a runtime error if you call it again before the previous request finishes. Check `isResponding`" ([Generating content](https://developer.apple.com/documentation/foundationmodels/generating-content-and-performing-tasks-with-foundation-models)). The error is `concurrentRequests` ([GenerationError](https://developer.apple.com/documentation/foundationmodels/languagemodelsession/generationerror)); iOS 27 adds `transcriptMutationWhileResponding` ([LanguageModelSession.Error](https://developer.apple.com/documentation/foundationmodels/languagemodelsession/error)).
- **Multiple sessions.** "You can follow the Swift concurrency rules to run multiple Foundation Models sessions / tasks concurrently. The framework doesn't impose any extra rules … Note that the inference tasks will eventually run on the neural engine serially though" (Ziqiao Chen) ([forum 798113](https://developer.apple.com/forums/thread/798113)); "You can create multiple sessions to run multiple requests in parallel" ([Gubarenko Q&A](https://antongubarenko.substack.com/p/ios-26-foundation-model-framework-f6d)). So concurrency is legal but buys no throughput.
- **Background.** "You can run a Foundation Model session in a background process, but on the operating-system level background calls to the on-device model are rate limited … the model is a shared resource across the operating system" ([forum 798113](https://developer.apple.com/forums/thread/798113)). `rateLimited` "will only happen if your app is running in the background and exceeds the system defined rate limit" ([rateLimited](<https://developer.apple.com/documentation/foundationmodels/languagemodelsession/generationerror/ratelimited(_:)>)). No foreground rate limit is documented.
- **Prewarm.** `prewarm(promptPrefix:)` loads assets and can pre-process a known prompt prefix; call it "when you have a strong signal that the user will interact with the session within a few seconds" and only with "at least 1 second" before `respond`; it "doesn't guarantee that the system loads your assets immediately, particularly if your app is running in the background or the system is under load" ([prewarm](<https://developer.apple.com/documentation/foundationmodels/languagemodelsession/prewarm(promptprefix:)>)).
- **Single- vs multi-turn.** "For single-turn interactions, create a new session each time; for multiturn interactions … reuse the same session" ([Generating content](https://developer.apple.com/documentation/foundationmodels/generating-content-and-performing-tasks-with-foundation-models)).
- **Feedback.** `logFeedbackAttachment(sentiment:issues:desiredOutput:)` serializes the transcript for Feedback Assistant ([LanguageModelSession](https://developer.apple.com/documentation/foundationmodels/languagemodelsession)).

## 6. Availability

`SystemLanguageModel.default.availability` is `.available` or `.unavailable(reason)` with
`UnavailableReason`: `deviceNotEligible` ("The device does not support Apple Intelligence"),
`appleIntelligenceNotEnabled` ("Apple Intelligence is not enabled on the system"),
`modelNotReady` ("The models aren't available on the user's device" — downloading or other
system reasons) ([UnavailableReason](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel/availability-swift.enum/unavailablereason), [Generating content](https://developer.apple.com/documentation/foundationmodels/generating-content-and-performing-tasks-with-foundation-models)). Apple's UI advice per case: hide the feature / tell the user they can opt in / say try again later ([WWDC25 259](https://developer.apple.com/videos/play/wwdc2025/259/)). `isAvailable` is the boolean shortcut; `contextSize` itself throws if the model is unavailable ([SystemLanguageModel](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel), [contextSize](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel/contextsize)). At runtime, availability "depends on whether the device and region supports Apple Intelligence" ([SystemLanguageModel](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel)). iOS 27 adds `assetsUnavailable` under `SystemLanguageModel.Error` ([SystemLanguageModel.Error](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel/error)).

**Devices** (Apple Intelligence): "iPhone 15 Pro models, and iPhone 16 models or later"; "iPad
mini (A17 Pro), and iPad models with M1 and later"; Macs with Apple silicon; Apple Vision Pro;
Apple Watch Series 6+/Ultra/SE 2 only when paired with an eligible iPhone (and on watchOS 27
the framework runs via Private Cloud Compute) ([Apple support](https://support.apple.com/en-us/121115), [WWDC26 241](https://developer.apple.com/videos/play/wwdc2026/241/)). Framework minimums: iOS/iPadOS/macOS/visionOS 26.0, watchOS 27.0 ([Foundation Models](https://developer.apple.com/documentation/foundationmodels)).

**Languages.** Apple Intelligence: English, Danish, Dutch, French, German, Italian, Norwegian,
Portuguese, Spanish, Swedish, Turkish, Chinese (Simplified and Traditional), Japanese, Korean,
Vietnamese ([Apple support](https://support.apple.com/en-us/121115)). `supportedLanguages`
returns 23 `Locale.Language` values (e.g. en-US/GB/AU, es-ES/419/US, zh-CN/TW/HK, pt-BR/PT,
fr-FR/CA) ([Riyam](https://rudrank.com/exploring-foundation-models-supported-languages-internationalization)). "It performs best with English but can handle several major languages" ([Gubarenko Q&A](https://antongubarenko.substack.com/p/ios-26-foundation-model-framework-f6d)). The set "can change across releases; so make sure to check at runtime" ([Riyam](https://rudrank.com/exploring-foundation-models-supported-languages-internationalization)); iOS 27 adds `supportsLocale(_:)` ([SystemLanguageModel](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel)).

## 7. Safety and guardrails

Two built-in layers: the model's training "to handle sensitive topics with care" and
"Guardrails that aim to block harmful or sensitive content, such as self-harm, violence, and adult
materials" ([Safety article](https://developer.apple.com/documentation/foundationmodels/improving-the-safety-of-generative-model-output)). "Guardrails are applied to both the input and the output of the model. Your instructions, prompts, and tool calls are all considered inputs" ([WWDC25 248](https://developer.apple.com/videos/play/wwdc2025/248/)).

**Errors.**

- `guardrailViolation` — "the system's safety guardrails are triggered by content in a prompt or the response generated by the model" ([GenerationError](https://developer.apple.com/documentation/foundationmodels/languagemodelsession/generationerror)). Not retryable with the same input.
- `refusal(_:_:)` — "the model refused to answer". With plain-string output there is no error; the text simply starts with something like "Sorry, I can't help with that…" and "You might not be able to programmatically determine whether a string response is a normal response or a refusal". With guided generation "there's no placeholder for a refusal message. Instead, the model throws a `refusal` error"; `refusal.explanation` asynchronously generates a user-facing reason (fall back to `debugDescription`) ([Safety article](https://developer.apple.com/documentation/foundationmodels/improving-the-safety-of-generative-model-output)).
- `unsupportedLanguageOrLocale` — "the model is prompted to respond in a language that it does not support" ([GenerationError](https://developer.apple.com/documentation/foundationmodels/languagemodelsession/generationerror)). Pre-check with `supportedLanguages.contains(Locale.current.language)` ([WWDC25 301](https://developer.apple.com/videos/play/wwdc2025/301/)).

**Tuning.** `SystemLanguageModel(guardrails: .permissiveContentTransformations)` (available
since 26.0) skips the guardrail check for **string** output only — guided generation still runs
default guardrails — and the model "may still produce a refusal message" ([Safety article](https://developer.apple.com/documentation/foundationmodels/improving-the-safety-of-generative-model-output), [Guardrails](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel/guardrails)). iOS 26.4 shipped "Improved Guardrails: reduced possibility of blocking benign content" ([Updates](https://developer.apple.com/documentation/updates/foundationmodels)); false positives on innocuous prompts still occur in the field ([Drobinin](https://drobinin.com/consulting/foundation-models-apple-intelligence/putting-apple-foundation-models-in-a-real-app/)). Guardrails are per-model; PCC's "have different policies that you can't directly configure" ([Safety article](https://developer.apple.com/documentation/foundationmodels/improving-the-safety-of-generative-model-output)).

**Handling.** For built-in prompts, rephrase to find the trigger. For user prompts, "give
people a clear message … 'Sorry, this feature isn't designed to handle that kind of input'". For
proactive (non-user-initiated) features "you can simply ignore the error" ([Safety article](https://developer.apple.com/documentation/foundationmodels/improving-the-safety-of-generative-model-output), [WWDC25 248](https://developer.apple.com/videos/play/wwdc2025/248/)). Recommended extra layers: safety sentences in instructions (a role statement at the very start "with permission to work in a domain" reduces over-blocking), wrapping user input inside your own prompt template, enum-constrained outputs, a deny list, adversarial test sets, and re-running them on every OS model update ([Safety article](https://developer.apple.com/documentation/foundationmodels/improving-the-safety-of-generative-model-output)).

## 8. Prompt design for a 3B model

- **Trust order.** "The model is trained to obey instructions over prompts … it's best not to interpolate untrusted user input into the instructions" ([WWDC25 286](https://developer.apple.com/videos/play/wwdc2025/286/)). Instructions are the first transcript entry and are mostly static ([WWDC25 301](https://developer.apple.com/videos/play/wwdc2025/301/)).
- **Length.** "Aim for a maximum of 1–3 paragraphs for prompts and instructions … Avoid instructions with significant background information, policy, or extra context. Use concise and imperative language" ([TN3193](https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window)). "Long, complicated prompts cause slower responses and unpredictable results. Break complex tasks into a series of specific prompts" ([Generating content](https://developer.apple.com/documentation/foundationmodels/generating-content-and-performing-tasks-with-foundation-models)).
- **One task.** "The model will perform best when given a single specific task in detail"; for complex reasoning "try breaking down your task prompt into simpler steps" ([WWDC25 248](https://developer.apple.com/videos/play/wwdc2025/248/)); "split the task into smaller steps, run each step with a new language model session, and then assemble the results" ([TN3193](https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window)).
- **Few-shot.** "less than five examples … directly into your prompt" ([WWDC25 248](https://developer.apple.com/videos/play/wwdc2025/248/)); instructions may include example responses ([Generating content](https://developer.apple.com/documentation/foundationmodels/generating-content-and-performing-tasks-with-foundation-models)).
- **Output length.** Phrases like "in three sentences", "in a few words", "in detail"; `@Guide(.maximumCount)` on arrays; `maximumResponseTokens` only as a runaway guard because "enforcing a strict token response limit can lead to the model producing malformed results" ([WWDC25 248](https://developer.apple.com/videos/play/wwdc2025/248/), [TN3193](https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window)).
- **Steering.** Role in the prompt controls voice; all-caps "DO NOT" works for stopping behaviour ([WWDC25 248](https://developer.apple.com/videos/play/wwdc2025/248/)).
- **Sampling.** `GenerationOptions(sampling: .greedy)` for determinism (demos, tests); lower `temperature` for stability, higher for variety; `random(top:seed:)` / `random(probabilityThreshold:seed:)` with a seed for reproducible randomness ([WWDC25 301](https://developer.apple.com/videos/play/wwdc2025/301/), [SamplingMode](https://developer.apple.com/documentation/foundationmodels/generationoptions/samplingmode)). Note: the API doc caps `temperature` at 1.0 ([temperature](https://developer.apple.com/documentation/foundationmodels/generationoptions/temperature)). iOS 27 renames `sampling` to `samplingMode` ([GenerationOptions](https://developer.apple.com/documentation/foundationmodels/generationoptions)).
- **Tooling.** `#Playground` in Xcode for iteration; 26.4 playgrounds show input/response token counts against 4,096 ([Updates](https://developer.apple.com/documentation/updates/foundationmodels)).

## 9. Adapters

The Foundation Models Adapter Training Toolkit is "a Python training workflow and utilities to
package adapters"; it trains LoRA "rank 32 adapters" ([Adapter toolkit](https://developer.apple.com/apple-intelligence/foundation-models-adapter/), [Apple ML 2025](https://machinelearning.apple.com/research/apple-foundation-models-2025-updates)). Facts that matter for a small project:

- "Each adapter will take approximately 160 MB"; do not bundle — "host your adapters on a server … using the Background Assets framework".
- "Each adapter is compatible with a single specific system model version … you will need to train a different adapter for every version of the system model" (three versions are live today: 26.0–26.3, 26.4, 27.0).
- Shipping requires the Account Holder to request the `com.apple.developer.foundation-model-adapter` entitlement; training and local testing do not.
- Training hardware: "Mac with Apple silicon and at least 32GB memory, or Linux GPU machines", Python 3.11+.
- "Version 26.0.0 is the last release of this toolkit and is not compatible with macOS, iOS, iPadOS, or visionOS 27 and later" — i.e. a new toolkit is needed per model generation, and the 27 toolkit was not yet on the page at research time.
- The weights in the toolkit "are only permitted … for training adapters".
  ([Adapter toolkit](https://developer.apple.com/apple-intelligence/foundation-models-adapter/))

Apple's own `.contentTagging` use case is a shipped adapter you get for free: "first class
support for tag generation, entity extraction, and topic detection" ([WWDC25 286](https://developer.apple.com/videos/play/wwdc2025/286/)). Independent guidance: "Default to prompt engineering and tool calling"; adapters only when prompts cannot reach the needed accuracy ([Crosley](https://blakecrosley.com/blog/foundation-models-custom-adapters)). Verdict for Goliath: not realistic as a core dependency — per-OS retraining, 160 MB per variant, server hosting, and an entitlement gate make it an optional extension point at most.

## 10. What changed since 26.0

- **26.1** — a tool can access the session transcript from inside `call` (reported as beta in an Apple Q&A) ([Gubarenko Q&A](https://antongubarenko.substack.com/p/ios-26-foundation-model-framework-f6d)). No documented 26.2/26.3 API changes.
- **26.4 (Feb 2026)** — updated on-device model "with improved instruction-following and tool-calling abilities"; improved guardrails; `tokenCount(for:)` and `contextSize` (back-deployed); token counts in `#Playground` ([Updates](https://developer.apple.com/documentation/updates/foundationmodels)). March 2026: Python SDK `apple-fm-sdk` ([Python SDK errors](https://apple.github.io/python-apple-fm-sdk/api/errors.html)).
- **27.0 / WWDC26 (June 2026)** — `LanguageModel` protocol so any provider (Apple on-device, `PrivateCloudComputeLanguageModel`, `CoreAILanguageModel`, `MLXLanguageModel`, Anthropic/Google packages) backs a `LanguageModelSession`; PCC: 32K context, `ContextOptions(reasoningLevel: .light/.moderate/.deep)`, per-user daily quota (higher with iCloud+), free for apps under 2 M first-time downloads, entitlement `com.apple.developer.private-cloud-compute`; image `Attachment` in prompts ("larger images will consume more tokens"); `DynamicProfile` to swap instructions/tools/model mid-session; `ToolCallingMode`; built-in `OCRTool`, `BarcodeReaderTool`, Spotlight search tool; `usage` on responses and sessions; `transcriptErrorHandlingPolicy`; new error enums; Evaluations framework; `fm` CLI on macOS 27 (`fm serve` = local OpenAI-compatible endpoint); watchOS 27 via PCC; new on-device model (AFM 3 Core / Core Advanced) with 8K context on newer devices; framework core to be open-sourced ([WWDC26 241](https://developer.apple.com/videos/play/wwdc2026/241/), [WWDC26 319](https://developer.apple.com/videos/play/wwdc2026/319/), [WWDC26 339](https://developer.apple.com/videos/play/wwdc2026/339/), [Updates](https://developer.apple.com/documentation/updates/foundationmodels), [Magda](https://ivanmagda.dev/posts/wwdc26-foundation-models-year-two/)).

## Implications for a harness (Goliath)

1. **Budget the window explicitly, and read it at runtime.** Call `contextSize` (4,096 on every 26.x device; 8,192 only on 27 + newer silicon) and `tokenCount(for:)` on instructions, each tool, and each transcript entry before every turn. Empirically ~16 tokens per instruction line and ~70 per small tool; with 3–5 tools plus 1–3 paragraphs of instructions expect **400–800 tokens fixed overhead**, leaving roughly **3,000 tokens for transcript, tool outputs, and the answer** on a 4K device. Reserve headroom for the response: the overflow error fires mid-generation ("4092 tokens…") when the input alone nearly fills the window.
2. **Compaction is the harness's job, and it must be proactive.** Once `exceededContextWindowSize` / `contextSizeExceeded` fires the session is dead. Trigger summarization or trimming at a threshold (~70% is a field-tested number), rebuild via `LanguageModelSession(transcript:)`, keep the instructions entry first, and `prewarm()` the replacement.
3. **Tool loops run inside `respond`; design tools, not loop control.** The framework may issue several parallel calls and chain serial calls before returning, and the only observation point is the `transcript` (plus, from 26.1, the transcript inside `call`). A JS tool must be `async` and idempotent under parallel invocation; the JS bridge round-trip stalls generation, so keep tool bodies fast. Structured output that depends on which tool ran needs a side channel (Apple's own workaround).
4. **Cap tools at 3–5 per session and keep every description to one short phrase.** Split agents into task-scoped sessions with different tool subsets rather than one session with a big toolbox; pre-run tools whose output is always needed and inline it into the prompt.
5. **One request in flight per session; serialize everything on the device.** Track `isResponding`, queue requests, and don't expect throughput from parallel sessions — the Neural Engine serializes inference. Treat `concurrentRequests` as a harness bug, not a runtime condition.
6. **Foreground only, in practice.** Background inference is rate limited by the OS; the harness should pause or defer work when the app backgrounds and surface `rateLimited` as "retry when foregrounded".
7. **Plan on ~30 tok/s and ~0.6 ms per prompt token.** A 3,000-token prompt is ~2 s of prefill; multi-step agent turns with tool chains will run many seconds. Stream (`streamResponse`) and `prewarm` when there is ≥1 s of warning.
8. **Use guided generation for every decision the harness makes** (routing, tool selection, classification, extraction) — constrained decoding is a hard structural guarantee — and translate JS/JSON schemas into `DynamicGenerationSchema` at the bridge. Keep types flat and names short; each schema is prompt tokens. Order properties so reasoning fields precede answers.
9. **Never use the model for math, code, or world knowledge.** Route those to tools (arithmetic in JS, lookups in the app) and keep the model to summarize/extract/classify/short-dialog.
10. **Instructions are the trust boundary.** Static, developer-authored, ≤3 paragraphs, with a role sentence first; user text goes only in prompts, wrapped in a template. Few-shot: at most four examples.
11. **Model three non-retryable failures distinctly.** `guardrailViolation` and `unsupportedLanguageOrLocale` → rephrase or refuse, never retry the same input; `refusal` (guided generation) → ask `refusal.explanation`; string refusals are undetectable without a second classification pass. Consider `.permissiveContentTransformations` for string-only transformation tasks over user content.
12. **Gate on availability and language up front.** Three distinct unavailable reasons need three UIs; `supportedLanguages` decides whether to prompt in the user's locale at all.
13. **Compile against both error spellings.** Keep an adapter layer mapping `GenerationError` (26) and `LanguageModelError` / `LanguageModelSession.Error` (27) onto one harness error type.
14. **Pin behaviour per model version.** Three on-device model versions coexist (26.0–26.3, 26.4, 27.0) with different tool-calling quality and guardrail strictness; run the harness's prompt evals on each.
15. **Leave adapters out of the core.** Per-version retraining, 160 MB assets, hosting, and an entitlement make them an opt-in extension, not a dependency.
16. **Design for iOS 27's `LanguageModel` protocol as the escape hatch.** The same session/tool/schema code can target PCC (32K, reasoning) or a cloud model; a harness that keeps its abstractions aligned with `LanguageModelSession` gets that for free.
