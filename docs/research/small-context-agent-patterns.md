# Small-context agent patterns: prior art and best practices for Goliath

Engineering brief for Goliath, an agent harness for the ~3B on-device Apple
Foundation Model (4,096-token shared context window) driven from React
Native / Expo through the Vercel AI SDK. Researched 2026-09-02. Every claim
carries a URL; numbers are quoted from the source, not extrapolated.

The platform facts that constrain everything below:

- The on-device `SystemLanguageModel` has a fixed 4,096-token context window
  and "all the input and response in the generation process contribute tokens
  to the context window" — one budget for instructions, prompts, tool
  definitions, tool output, and responses, cumulative over the session, not
  per request (https://developer.apple.com/forums/thread/806542,
  https://developer.apple.com/forums/thread/797512).
- iOS 26.4 added `SystemLanguageModel.contextSize` (returns 4096) and
  `tokenCount(for:)`, which measures instructions, prompts, tool definitions,
  and whole transcripts; the worked example measures a trivial instruction at
  ~16 tokens and one tool definition at ~68 tokens
  (https://artemnovichkov.com/blog/tracking-token-usage-in-foundation-models,
  https://developer.apple.com/documentation/FoundationModels/SystemLanguageModel/tokenCount(for:)).
- Tool calling on Apple's model is guided generation: arguments are
  `@Generable`, so the schema is enforced during decoding, and "the framework
  automatically and optimally handles the potentially complex call graphs of
  parallel and serial tool calls"
  (https://machinelearning.apple.com/research/apple-foundation-models-2025-updates,
  https://developer.apple.com/videos/play/wwdc2025/301/).
- Through the AI SDK provider `@react-native-ai/apple`, tools must be
  pre-registered with `createAppleProvider({ availableTools })`, Apple
  Intelligence executes them (not the SDK), and `stopWhen` / `onStepStart` /
  `onStepEnd` and tool-call streaming are unsupported
  (https://ai-sdk.dev/providers/community-providers/react-native-apple).
- WWDC26 added a Private Cloud Compute model selected with one line
  (`LanguageModelSession(model: PrivateCloudComputeLanguageModel())`), a 32,768
  token context, reasoning, a per-user daily quota exposed as
  `model.quotaUsage.isLimitReached`, availability only for apps under 2M
  downloads, and identical `Generable` / `Tool` behaviour on both models
  (https://developer.apple.com/videos/play/wwdc2026/319/). The framework now
  targets a `LanguageModel` protocol, so `ClaudeLanguageModel` or
  `GeminiLanguageModel` can drop into the same session
  (https://ivanmagda.dev/posts/wwdc26-foundation-models-year-two/).

## 1. Multi-agent and subagent patterns for small windows

### What the field agrees on

**Orchestrator-workers is the pattern; the orchestrator sees summaries, not
traces.** Anthropic's definition: "A central LLM dynamically breaks down tasks,
delegates them to worker LLMs, and synthesizes their results"
(https://www.anthropic.com/engineering/building-effective-agents). In their
production research system each subagent "needs an objective, an output
format, guidance on the tools and sources to use, and clear task boundaries";
subagents act as "intelligent filters" that return a list to the lead agent,
and vague briefs produced duplicated work (one subagent on the 2021 chip
crisis while two others duplicated 2025 supply-chain research)
(https://www.anthropic.com/engineering/multi-agent-research-system).

**Subagent output is compressed hard before it re-enters the parent.**
Anthropic's context-engineering post: a specialised sub-agent returns "only a
condensed, distilled summary of its work (often 1,000-2,000 tokens)" to the
coordinator, and the guiding objective is "the smallest possible set of
high-signal tokens that maximize the likelihood of some desired outcome"
(https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).
At a 200k window that is 0.5-1%; the same ratio at 4k is 20-40 tokens, which
is why Goliath's "≤100 tokens back" is on the generous side, not the stingy
side.

**Isolation is the whole point of a subagent, and the brief is the only
channel.** Claude Code's SDK: "each subagent runs in its own conversation,
which starts fresh ... intermediate tool calls and results stay inside the
subagent; only its final message returns to the parent", and "The only
content you pass from parent to subagent is the Agent tool's prompt string,
so include any file paths, error messages, or decisions the subagent needs
directly in that prompt" (https://code.claude.com/docs/en/agent-sdk/subagents).
LangChain's deepagents says the same: the parent "receives only the
subagent's final result, not intermediate tool calls or raw data", and
descriptions must be "specific and action-oriented" ("Analyzes financial data
and generates investment insights" vs "Does finance stuff")
(https://docs.langchain.com/oss/javascript/deepagents/subagents).

**Effort scaling is written into the orchestrator prompt as numbers.**
Anthropic's lead agent is told: "Simple fact-finding: just 1 agent with 3-10
tool calls"; comparisons "2-4 subagents with 10-15 calls each"; only complex
research gets 10+ subagents. Multi-agent systems "use about 15× more tokens
than chats" (https://www.anthropic.com/engineering/multi-agent-research-system).
On a phone that multiplier is battery and latency, so Goliath's conductor
should carry an explicit budget table in the same style.

**The counter-argument, and how it resolves.** Cognition: "Share context, and
share full agent traces, not just individual messages" and "Actions carry
implicit decisions, and conflicting decisions carry bad results" — the
Flappy-Bird example where two parallel subagents built mismatched assets. The
remedy they propose for long tasks is a dedicated model that "compress[es] a
history of actions & conversation into key details, events, and decisions",
which they admit "is hard to get right"
(https://cognition.com/blog/dont-build-multi-agents). LangChain's synthesis:
multi-agent wins on "breadth-first, parallelizable" and read-heavy tasks,
loses when "many dependencies between agents" exist, and "without detailed
task descriptions, agents duplicate work, leave gaps, or fail to find
necessary information" (https://www.langchain.com/blog/how-and-when-to-build-multi-agent-systems).
Cognition's later position is that the working setups share one property:
"one main loop carries state, subagents are stateless workers with narrow
scope" (https://x.com/walden_yan/status/2047054554433462360). That is exactly
the conductor/worker/scribe split: Goliath cannot share full traces (4k), so
it must make workers narrow and stateless and make the scribe's summary the
carrier of "decisions", not just facts.

**Handoffs / relay / baton.** OpenAI's cookbook defines a routine as "a list
of instructions in natural language (which we'll represent with a system
prompt), along with the tools necessary to complete them", a handoff as an
agent "handing off an active conversation to another agent", implemented by a
tool that returns an `Agent` object, and warns "if we try growing the routine
with too many different tasks it may start to struggle"
(https://developers.openai.com/cookbook/examples/orchestrating_agents). Swarm
was "lightweight & stateless with no persistent memory or threads" and is now
superseded by the Agents SDK (https://github.com/openai/swarm). The relay
pattern differs from orchestrator-worker in one way that matters at 4k: in a
handoff the next agent inherits the conversation; in Goliath it must inherit
only the scribe's summary.

### How many steps before quality collapses

- "LLMs Get Lost in Multi-Turn Conversation": across 200k simulated
  conversations, every top open and closed model showed "an average drop of
  39%" from single-turn to multi-turn, and "when LLMs take a wrong turn in a
  conversation, they get lost and do not recover"
  (https://arxiv.org/abs/2505.06120). Fresh worker contexts per step are the
  direct countermeasure.
- τ-bench: even gpt-4o "succeed[s] on <50% of the tasks" and is inconsistent
  ("pass^8 <25% in retail") on multi-step tool tasks
  (https://arxiv.org/abs/2406.12045).
- Chroma's Context Rot study of 18 models: "model performance degrades as
  input length increases, often in surprising and non-uniform ways", and
  distractor damage "amplifies as input length grows"
  (https://www.trychroma.com/research/context-rot). Lost-in-the-Middle showed
  a U-shaped accuracy curve with >30% degradation for mid-context facts
  (https://cobusgreyling.medium.com/llm-context-rot-28a6d0399655).
- Framework defaults for loop length: OpenAI Agents SDK `maxTurns` defaults to
  10 (https://openai.github.io/openai-agents-js/guides/running-agents/),
  Vercel `ToolLoopAgent` stops at 20 steps by default
  (https://vercel.com/academy/filesystem-agents/agent-skeleton), and Claude
  Code caps subagent nesting at 3 layers and 20 concurrent subagents
  (https://code.claude.com/docs/en/agent-sdk/subagents). Those are for
  200k-window frontier models; for a 3B model with an 8% multi-turn BFCL score
  (see §2) the per-worker loop should be 1-3 steps.

### Rules that transfer to 4k

1. The conductor sees: user ask, the scribe's rolling summary, one line per
   completed step. Never a tool result, never a worker transcript.
2. Every worker brief has the four Anthropic parts (objective, output format,
   tools, boundaries) and is the _only_ input; if the worker needs a fact,
   the fact is in the brief.
3. Workers are stateless and narrow; the scribe records decisions, not just
   facts, because "actions carry implicit decisions".
4. Effort budget is explicit and numeric in the conductor prompt.

## 2. Small-model tool calling reliability

### Benchmarks

- BFCL small-model numbers: xLAM-2-3b-fc-r reaches "65.74% overall accuracy
  ... 55.62% in multi-turn"; xLAM-2-1b-fc-r "53.97% overall accuracy, while
  its multi-turn accuracy is 8.38%" (https://arxiv.org/abs/2511.22138, TinyLLM,
  which evaluated <1B and 1-3B models with the BFCL harness and concluded
  "Medium-sized models (1-3B parameters) significantly outperform
  ultra-compact models"). On BFCL v4 a purpose-built 1B (xLAM-2-1b, 30.44)
  scores ~3× a general 1B (Llama-3.2-1B-Instruct, 10.82)
  (https://medium.com/@minhle_0210/5-tiny-language-models-for-tool-calling-part-3-ebcda32c2518).
  Qwen3 tech report on BFCL v3: Qwen3-0.6B 46.4%, Qwen3-1.7B 56.6%
  (https://arxiv.org/html/2505.09388v1). The live leaderboard is
  https://gorilla.cs.berkeley.edu/leaderboard.html.
- The takeaway for a general-purpose 3B: single-turn, single-tool calls are
  reliable enough to build on; multi-turn tool chains inside one context are
  not. Every multi-step plan must be broken into single-turn worker calls.
- Apple reports only that "Model post-training on tool-use data improved the
  model's reliability for this framework feature"
  (https://machinelearning.apple.com/research/apple-foundation-models-2025-updates);
  no BFCL number exists for the on-device model, so Goliath needs its own
  fixture eval (§6).

### Documented failure modes of small models

- "Small Models, Big Tasks" (SLMs, zero/few-shot/fine-tune): models "struggle
  significantly with adhering to the given output format" and "improve from
  zero-shot to few-shot and perform best with fine-tuning"
  (https://arxiv.org/abs/2504.19277).
- HammerBench (mobile-assistant dialogues): "different types of parameter
  name errors are a significant source of failure across different
  interaction scenarios"; imperfect instructions, intent shifts, and pronoun
  references all hurt (https://arxiv.org/abs/2412.16516).
- Hammer: small models are "misled by specific naming conventions"; the fix
  was function masking plus an irrelevance-augmented dataset so the model can
  answer "no function applies" (https://arxiv.org/abs/2410.04587,
  https://huggingface.co/MadeAgents/Hammer2.1-1.5b).
- PA-Tool: small models "hallucinate tool names absent from schemas due to
  schema misalignment" between pretraining naming and the provided schema;
  renaming tools/parameters toward pretraining-familiar names, with no
  retraining, gave "up to 17% overall accuracy gains" and an "80% reduction in
  schema misalignment errors" (https://arxiv.org/abs/2510.07248). Anthropic
  independently says agents "grapple with natural language names, terms, or
  identifiers significantly more successfully than they do with cryptic
  identifiers" (https://www.anthropic.com/engineering/writing-tools-for-agents).
- Tool count: production reports put measurable degradation "once tool counts
  pass roughly 10 to 15", with literature losses of "7-85% as tool catalogue
  size increases" and middle-of-list tools selected less often
  (https://tianpan.co/blog/2026-04-19-over-tooled-agent-problem). Anthropic's
  guidance is a "minimal viable set" with "minimal overlap in functionality"
  (https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
  and "a few thoughtful tools targeting specific high-impact workflows"
  (https://www.anthropic.com/engineering/writing-tools-for-agents).
- Constrained decoding helps and has a trap. Guided decoding took
  Qwen2.5-7B single-turn tool selection "49.5% → 78.1%"
  (https://arxiv.org/abs/2510.03847). But "Constraint Tax" found that when
  JSON-schema output constraints and tool calling are enabled together,
  "tool-call tokens become unreachable during decoding" and models silently
  stop calling tools; the fix is "Transparent Two-Pass Execution" that
  decouples the tool decision from the schema-constrained answer
  (https://arxiv.org/abs/2606.25605). Apple's stack constrains tool arguments
  at decode time by design, so the trap to avoid in Goliath is asking for a
  `Generable` final answer _and_ tools in the same turn.
- Apple-specific: "your tool is registered, your code is correct, the model
  just decided not to invoke it" is a real failure that only profiling
  reveals; the mitigation is "you give it tools instead of facts, and you
  make the tools the only path to a real value", and tools should return
  "a pre-formatted string like 'downloads over the last 7 days: 138'"
  (https://drobinin.com/consulting/foundation-models-apple-intelligence/putting-apple-foundation-models-in-a-real-app/).

### Practical tricks, each with its source

| Trick                                 | Evidence                                                                                                                                                                                                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ≤3-5 tools per session                | degradation past 10-15 tools; 68 tokens per definition on Apple's tokenizer (https://tianpan.co/blog/2026-04-19-over-tooled-agent-problem, https://artemnovichkov.com/blog/tracking-token-usage-in-foundation-models)                                                 |
| Flat schemas, enums over free text    | `@Guide` enums mean "the model cannot hallucinate a metric name" (https://drobinin.com/consulting/foundation-models-apple-intelligence/putting-apple-foundation-models-in-a-real-app/); parameter-name errors dominate HammerBench (https://arxiv.org/abs/2412.16516) |
| Pretraining-familiar names            | PA-Tool +17% (https://arxiv.org/abs/2510.07248)                                                                                                                                                                                                                       |
| One tool call per step                | multi-turn 8-55% vs single-turn 80%+ for 1-3B (https://arxiv.org/abs/2511.22138)                                                                                                                                                                                      |
| Router-then-tools                     | Anthropic routing workflow "classifies an input and directs it to a specialized followup task" (https://anthropic.com/engineering/building-effective-agents); OpenAI triage agent (https://developers.openai.com/cookbook/examples/orchestrating_agents)              |
| Few-shot examples in the brief        | zero→few-shot gains (https://arxiv.org/abs/2504.19277)                                                                                                                                                                                                                |
| Explicit "no tool" option             | Hammer irrelevance training (https://arxiv.org/abs/2410.04587); BFCL "relevance detection" category (https://arxiv.org/abs/2511.22138)                                                                                                                                |
| Validate + retry once on invalid JSON | "schema validity rate, executable call rate" as first-class metrics; "uncertainty-aware routing and verifier cascades" (https://arxiv.org/abs/2510.03847)                                                                                                             |
| Just-in-time schema loading           | 3B on-device agent: "Full tool definitions load only when tools are actually selected"; "6-fold reduction in initial system prompt overhead" and "10- to 25-fold reduction in context growth rate" (https://arxiv.org/abs/2511.03728)                                 |
| Poka-yoke argument design             | "redesign arguments so that it is harder to make mistakes" (https://www.anthropic.com/engineering/building-effective-agents)                                                                                                                                          |

## 3. Context compression that can run on a phone

### Structural (free, deterministic)

- Cap tool output at the tool. Claude Code "restrict[s] tool responses to
  25,000 tokens by default" and recommends "pagination, range selection,
  filtering, and/or truncation with sensible default parameter values" plus
  a `response_format: concise | detailed` parameter
  (https://www.anthropic.com/engineering/writing-tools-for-agents). Scaled to
  4k, the cap is a few hundred tokens.
- Tool-result clearing is the safest first cut: Anthropic's context editing
  clears old tool_use/result pairs server-side and reports "29% performance
  improvement with context editing alone, and 39% with context editing +
  memory tool" (https://platform.claude.com/docs/en/build-with-claude/context-editing,
  via https://claudelab.net/en/articles/api-sdk/compaction-api-context-management).
  OpenCode prunes old tool output but "protects last 40k tokens of tool
  output" (https://gist.github.com/badlogic/cd2ef65b0697c4dbe2d13fbecb0a0a5f).
- Serialisation format: YAML "typically results in 10-25% fewer tokens than
  equivalent JSON"; TOON's header-once tabular form shows "40% fewer tokens
  for uniform tabular data" but "loses its advantage" on hierarchical data
  (https://medium.com/@ffkalapurackal/toon-vs-json-vs-yaml-token-efficiency-breakdown-for-llm-5d3e5dc9fb9c,
  https://tashif.codes/blog/JSON-YAML-LLM). The on-device paper's
  "Minimalist Schema Serialization" is the same idea applied to tool
  definitions (https://arxiv.org/abs/2511.03728). `key: value` lines and
  pre-formatted strings are the right default for tool returns.

### Extractive selection with on-device embeddings

- Apple `NLContextualEmbedding` (iOS 17+) is a BERT-style transformer giving
  512-d vectors on iOS; the React Native wrapper reports ~19 ms (short text)
  to ~34 ms (~90 tokens) on iPhone 16 Pro, assets live in Apple's catalog with
  "zero impact on your app's size", and `prepare()` should be called ahead of
  first use (https://www.react-native-ai.dev/docs/apple/embeddings,
  https://www.callstack.com/blog/on-device-ai-introducing-apple-embeddings-in-react-native).
  `@react-native-ai/apple` exposes it as `apple.embeddingModel()` through the
  AI SDK `embed()` API (https://ai-sdk.dev/providers/community-providers/react-native-apple).
- Alternative: all-MiniLM-L6-v2 is 22.7M parameters, 384-d, ~90 MB, and ships
  pre-packaged for React Native ExecuTorch (with a Core ML backend on iOS)
  (https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2,
  https://www.npmjs.com/package/@react-native-rag/executorch,
  https://executorch.swmansion.com/). Static Model2Vec embeddings are
  available in Swift when even that is too heavy
  (https://github.com/shubham0204/model2vec.swift).
- Selection algorithm: LexRank computes sentence salience as eigenvector
  centrality over a cosine-similarity graph (https://arxiv.org/abs/1109.2128);
  a cheaper variant for a rolling window is "score each sentence by cosine to
  the query + cosine to the running summary, keep top-k under budget".
  Chroma's finding that "performance degrades more quickly in input length
  with lower similarity needle-question pairs" is the argument for query-aware
  selection over positional truncation (https://www.trychroma.com/research/context-rot).

### LLMLingua-2 on a phone

- LLMLingua-2 reframes compression as token classification with a
  bidirectional encoder; backbones are XLM-RoBERTa-large and multilingual
  BERT; it is "3x-6x faster than existing prompt compression methods" and
  gives "1.6x-2.9x" end-to-end acceleration at 2x-5x compression
  (https://arxiv.org/abs/2403.12968). The large checkpoint is listed at 0.6B
  parameters in F32 (https://huggingface.co/microsoft/llmlingua-2-xlm-roberta-large-meetingbank);
  the sibling `llmlingua-2-bert-base-multilingual-cased-meetingbank` is
  BERT-base class (~110M).
- No published Core ML or ExecuTorch port was found in this research; both
  backbones are standard encoders, so a coremltools/ONNX export is routine,
  but it is unverified work, not prior art.
- Latency caveat: "Prompt Compression in the Wild" found LLMLingua gives "up
  to 18% end-to-end speed-ups, when prompt length, compression ratio, and
  hardware capacity are well matched" and that "compression overhead often
  negates gains" otherwise; on a MacBook M1 Pro the compressor "constituted
  up to 60% of the total latency" for the base variant
  (https://arxiv.org/abs/2604.02985). On an iPhone with a 4k window, the win
  is fitting at all rather than speed, so LLMLingua-2 belongs at the end of
  the chain, optional, and only for the ~500-1,500 token payloads where
  structural and extractive passes were insufficient.

### Rolling summaries / compaction

- Claude Code compacts by "passing the message history to the model to
  summarize and compress the most critical details, preserving architectural
  decisions, unresolved bugs, and implementation details while discarding
  redundant tool outputs", then continues with the summary plus the five most
  recently accessed files; the tuning advice is "start by maximizing recall
  ... then iterate to improve precision"
  (https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).
  Its summary prompt asks for "What was accomplished - Current work in
  progress - Files involved - Next steps - Key user requests or constraints"
  and triggers near 95% of the window; Codex CLI rebuilds "initial context +
  recent user messages (up to 20k tokens) + summary"
  (https://gist.github.com/badlogic/cd2ef65b0697c4dbe2d13fbecb0a0a5f).
- Apple's own recommendation for `exceededContextWindowSize` is to condense
  the transcript and start a new session; community code drops system
  instructions and intermediate tool calls because "capturing the tools'
  final results and the decisions made is enough", then re-creates the
  session "injecting the newly created summary with basic instructions so the
  model knows it is not a normal user message"
  (https://zats.io/blog/making-the-most-of-apple-foundation-models-context-window/,
  https://developer.apple.com/forums/thread/797512).
- MemGPT's numbers are a good default for a 4k scribe: warn at ~70% of the
  window, flush at 100% by evicting ~50% of messages and folding them into a
  recursive summary (https://ar5iv.labs.arxiv.org/html/2310.08560).

### Token estimation without a tokenizer

- OpenAI's rule of thumb is 1 token ≈ 4 characters ≈ ¾ of a word for English
  (https://help.openai.com/en/articles/4936856-what-are-tokens-and-how-to-count-them);
  Anthropic's is ≈ 3.5 characters
  (https://blog.gopenai.com/counting-claude-tokens-without-a-tokenizer-e767f2b6e632).
  Practitioners put chars/4 at "approximately 80% accurate" for English and
  "within roughly 10-20% for ordinary English prose", drifting "much further
  for code, JSON, and non-Latin scripts"
  (https://textrepeater.com/counter/, https://ansezz.com/tools/token-counter/).
- Apple's tokenizer is not public and emoji, code, and non-Latin text
  "tokenize into many pieces" (https://zats.io/blog/making-the-most-of-apple-foundation-models-context-window/),
  but `tokenCount(for:)` is now the ground truth on iOS 26.4+ and is
  back-deployed (https://artemnovichkov.com/blog/tracking-token-usage-in-foundation-models).
  Use it to calibrate a chars-per-token constant per content class at
  runtime, and keep the heuristic only for pre-flight budgeting in JS.

### KV cache / prompt caching on device

- Apple exposes `LanguageModelSession.prewarm(promptPrefix:)`, which "loads
  the resources required for a session into memory and optionally caches a
  prefix of your prompt"; reported first-token latency reductions are "up to
  40%" and cold start otherwise costs "one-to-two-second[s]"
  (https://developer.apple.com/documentation/foundationmodels/languagemodelsession/prewarm(promptprefix:),
  https://medium.com/codex/make-your-foundation-llm-app-10-faster-on-ios-real-world-optimizations-38b6892132de,
  https://drobinin.com/consulting/foundation-models-apple-intelligence/putting-apple-foundation-models-in-a-real-app/).
  That is the only cache control available; there is no cross-session KV
  reuse API. The architectural fact underneath is that the on-device model
  shares KV caches between its two blocks to cut cache memory by 37.5%
  (https://machinelearning.apple.com/research/apple-foundation-models-2025-updates).
  Design consequence: keep worker system prompts byte-identical across
  workers so one prewarmed prefix serves all of them.

## 4. Memory for on-device agents

- MemGPT/Letta's tiering transfers directly: core memory (pinned, in-context,
  self-edited), recall memory (searchable transcript history outside the
  window), archival memory (external store queried by tool), with a
  memory-pressure warning at ~70% of the window and a recursive summary on
  flush (https://arxiv.org/abs/2310.08560, https://www.letta.com/blog/agent-memory/).
  At 4k the "core" block must be tiny (tens of tokens: name, timezone, a few
  standing preferences).
- Mem0's extraction/update loop (ADD / UPDATE / DELETE / NOOP against existing
  memories) is what keeps a store from growing without bound; it reports
  ">90% token cost" savings and "91% lower p95 latency" versus full-context
  (https://arxiv.org/abs/2504.19413). The update decision can be a single
  cheap worker call with a 4-way enum output.
- Zep's contribution is temporal validity on facts (a bi-temporal knowledge
  graph) and a claimed 94.8% vs 93.4% DMR score over MemGPT
  (https://arxiv.org/abs/2501.13956). For a phone, keep only the idea:
  every stored fact carries `observedAt` and optional `invalidatedAt`, so
  retrieval can prefer current facts without a graph engine.
- Anthropic's "structured note-taking": agents "regularly write notes
  persisted to memory outside of the context window" and pull them back in
  by reference ("just-in-time" retrieval of lightweight identifiers)
  (https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).
- Local vector store: 512-d Apple embeddings (or 384-d MiniLM) with cosine
  over a few thousand rows is a brute-force loop in JS or SQLite; no ANN index
  is warranted at personal-assistant scale. Apple's new `SpotlightSearchTool`
  gives on-device retrieval over Core Spotlight for free when the data is
  already indexed (https://ivanmagda.dev/posts/wwdc26-foundation-models-year-two/).
- Filesystem-as-memory is competitive: Letta's own benchmark had a
  file-based approach at 74.0% vs Mem0-graph 68.5%
  (https://codepointer.substack.com/p/agent-memory-systems-and-knowledge). A
  handful of markdown files plus embeddings is a defensible v1.

## 5. Escalation and routing between a local small model and the cloud

- **Cascades.** FrugalGPT's LLM cascade "learns which combinations of LLMs to
  use for different queries" with a scorer deciding whether to accept the
  cheap answer; it matched GPT-4 "with up to 98% cost reduction"
  (https://arxiv.org/abs/2305.05176). RouteLLM trains a binary router on
  preference data to pick strong vs weak before the call and reports cost
  reductions "over 2 times in certain cases" with routers that transfer when
  the model pair changes (https://arxiv.org/abs/2406.18665). Goliath is a
  cascade (try local, escalate on failure), not a pre-router, because the
  local call is free and private.
- **Apple's own design.** Apple Intelligence's orchestration layer
  (`modelmanagerd`) decides per request whether the ~3B on-device model can
  handle it and otherwise forwards to Private Cloud Compute; the decision "is
  not communicated to the user" (https://arxiv.org/html/2605.24239v1,
  https://www.apple.com/legal/privacy/data/en/intelligence-engine/). For
  third-party apps the developer makes that decision explicitly by
  constructing `PrivateCloudComputeLanguageModel()` (32K context, reasoning,
  daily per-user quota, `quotaUsage.isLimitReached`), and Apple's guidance is
  to check `model.isAvailable` and fall back, and not to show a dismissible
  alert when the quota is hit (https://developer.apple.com/videos/play/wwdc2026/319/).
  PCC is the first escalation tier for Goliath when eligible (<2M downloads);
  a third-party cloud agent is the second.
- **Confidence signals without logprobs.** Apple's API exposes no logprobs.
  What works:
  - Verbalised confidence: for RLHF models, "verbalized confidences emitted as
    output tokens are typically better-calibrated than the model's conditional
    probabilities", often cutting expected calibration error by ~50%; mapping
    a fixed vocabulary ("highly likely", "unlikely") to probabilities post hoc
    "often outperform[s] direct probability verbalization"
    (https://aclanthology.org/2023.emnlp-main.330/). Make the worker's
    ≤100-token return a `Generable` with a `confidence` enum.
  - Structural failure signals, as proposed for hermes-agent's local→cloud
    fallback: `repeated_tool_failure`, `invalid_output`, `no_progress`,
    `task_timeout`, `user_request`, with `max_local_attempts: 3`
    (https://github.com/NousResearch/hermes-agent/issues/15176). The SLM
    survey's production metrics are the same list seen as counters: "schema
    validity rate, executable call rate, and latency percentiles"
    (https://arxiv.org/abs/2510.03847).
  - Apple error classes are themselves signals: "exceededContextWindowSize is
    recoverable by rebuilding the session; guardrailViolation and
    unsupportedLanguageOrLocale are not"
    (https://drobinin.com/consulting/foundation-models-apple-intelligence/putting-apple-foundation-models-in-a-real-app/).
    Guardrail refusals should escalate, not retry.
  - A judge prompt is a second worker call with a 3-way enum
    (`done | retry | escalate`); Anthropic uses an LLM judge with a rubric
    for research outputs and finds a single judge call scoring 0-1 "most
    consistent" (https://www.anthropic.com/engineering/multi-agent-research-system).
- **Cost accounting.** Escalation must carry the scribe's summary, not the
  transcript (hermes proposes continuing "using the existing conversation
  context, tool results, and intermediate progress", which Goliath can only
  do via the summary). Track per task: local tokens (from `tokenCount`),
  local wall-clock, escalation tier, cloud input/output tokens, and PCC quota
  consumed; RouteLLM-style reporting is "% of calls routed to the strong
  model" against a quality threshold (https://www.lmsys.org/blog/2024-07-01-routellm/).

## 6. Evaluation for agent harnesses

- **What to measure.** τ-bench compares "the database state at the end of a
  conversation with the annotated goal state" and reports pass^k for
  reliability over k trials (https://arxiv.org/abs/2406.12045). τ²-bench's
  task schema is worth copying verbatim: `evaluation_criteria` with `actions`
  (reference tool calls), `env_assertions`, `communicate_info` (strings the
  user must be told), `nl_assertions` (judge-checked), and `reward_basis`
  (which components multiply into the reward); by default actions are not
  compared directly — the reference trajectory is replayed to a target DB
  hash and "Any agent trajectory that produces an equivalent end state
  passes" (https://github.com/sierra-research/tau2-bench/blob/main/docs/evaluation.md).
- AgentBench's finding that "poor long-term reasoning, decision-making, and
  instruction following abilities are the main obstacles" is why fixtures
  should be short and many rather than long and few
  (https://arxiv.org/abs/2308.03688).
- **Tool-call assertions.** promptfoo's tool-use example asserts
  `finish-reason: tool_calls` and provides F1 over the set of called tool
  names with threshold 1.0 by default, plus JavaScript assertions on
  arguments (https://github.com/promptfoo/promptfoo/tree/main/examples/eval-tool-use,
  https://www.promptfoo.dev/docs/configuration/expected-outputs/deterministic/).
  Anthropic's tool-writing loop is prototype → eval → improve, with tasks
  "grounded in real-world uses" (https://www.anthropic.com/engineering/writing-tools-for-agents).
- **Measuring on-device vs escalated.** Report the outcome as a 2×2:
  {handled locally, escalated} × {pass, fail}, plus pass^k at k=3 for the
  local path. A fixture declares `escalation: "forbidden" | "allowed" |
"expected"`; a local pass on an `expected` fixture is a win, an escalation
  on a `forbidden` fixture is a fail. This is the SLM survey's "cost per
  successful task" made concrete (https://arxiv.org/abs/2510.03847). Because
  Apple's sampler varies by ~100 tokens run to run, evals should pin
  `GenerationOptions(sampling: .greedy)` or a seed
  (https://developer.apple.com/forums/thread/806542).
- **Runner shape to copy.** A fixture is one JSON/TS object: `ask`,
  `seed` (memory + tool-backed fake state), `expect.toolCalls` (ordered list of
  `{ name, args?: partial }`), `expect.finalState` (hash of fake store),
  `expect.answer` (rubric bullets for a judge, or regex), `expect.escalation`,
  `budget` (max steps, max local tokens). Run with `bun test`; no framework
  needed beyond a table-driven test and a fake tool registry.

## 7. API-shape prior art for a TypeScript / React Native developer

| Library                         | Construct                                                                                                           | Run                                                                                    | Loop control                                                                     | Sub-agents / handoff                                                                                                                                                         | Approval                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Vercel AI SDK 6 `ToolLoopAgent` | `new ToolLoopAgent({ model, instructions, tools, toolChoice, stopWhen, prepareStep, activeTools, output })`         | `agent.generate({ prompt })` / `agent.stream(...)` returning `text`, `steps`           | `stopWhen: isStepCount(n)` (spelled `stepCountIs` in AI SDK 5), default 20 steps | none built in; agents-as-tools                                                                                                                                               | `toolApproval: { toolName: 'user-approval' }` (https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent) |
| Mastra                          | `new Agent({ id, name, instructions, model, tools, memory })`                                                       | `agent.generate()` / `stream()` returning `text, toolCalls, toolResults, steps, usage` | stop condition                                                                   | deterministic `createWorkflow` with steps/branches; supervisor networks (https://mastra.ai/docs/agents/overview, https://mastra.ai/docs/workflows/overview)                  | via workflow suspend                                                                                          |
| LangChain deepagents            | `createDeepAgent({ model, tools, subagents: [{ name, description, systemPrompt, tools, model }] })`                 | LangGraph `invoke`/`stream`                                                            | middleware                                                                       | `task()` tool; only the final result returns (https://docs.langchain.com/oss/javascript/deepagents/subagents)                                                                | interrupt middleware                                                                                          |
| OpenAI Agents SDK JS            | `new Agent({ name, instructions, model, tools, handoffs, outputType, guardrails })`                                 | `run(agent, input)` → `finalOutput`, `history`                                         | `maxTurns` default 10, `MaxTurnsExceededError`                                   | handoffs are tools that switch the active agent (https://openai.github.io/openai-agents-js/guides/agents/, https://openai.github.io/openai-agents-js/guides/running-agents/) | input/output/tool guardrails                                                                                  |
| Claude Agent SDK                | `query({ prompt, options: { agents: { name: { description, prompt, tools, model, maxTurns } } } })` async generator | iterate messages                                                                       | `maxTurns`, `maxBudgetUsd`, depth 3 / concurrency 20 env caps                    | `Agent` tool; fresh context; final message only (https://code.claude.com/docs/en/agent-sdk/subagents)                                                                        | permission modes                                                                                              |

What a TypeScript RN developer expects in 2026: a class or factory named
`Agent`/`...Agent` taking `{ model, instructions, tools }`, `tool({ description,
inputSchema: z.object(...), execute })` from the AI SDK, `generate` / `stream`
returning `{ text, steps, usage }`, a `stopWhen`-style loop guard, an
approval hook per tool, and sub-agents declared as a record of
`{ description, prompt, tools }`. Goliath should keep those names
(`instructions`, `tools`, `stopWhen`, `needsApproval`, `steps`) and add only
what is new: `budget` (tokens/steps per session), `escalate` (a `LanguageModel`
for the cloud tier), and `compress` (the chain). On the Apple provider,
`stopWhen` is a no-op today (https://ai-sdk.dev/providers/community-providers/react-native-apple),
so Goliath's loop must live above the provider, one provider call per step.

## Design rules for Goliath

Each rule is testable and cites the source that justifies it.

1. **Treat 4,096 as the whole session, shared by input and output, including
   tool definitions and tool results.** Budget to ~3,000 to leave room for
   the ~100-token sampling variance and the answer.
   (https://developer.apple.com/forums/thread/806542, https://developer.apple.com/forums/thread/797512)
2. **Measure with `tokenCount(for:)` on iOS 26.4+; fall back to chars/4
   (English) or chars/3 (code, JSON, non-Latin) only for pre-flight estimates
   in JS, and recalibrate the constant from real counts at runtime.**
   (https://artemnovichkov.com/blog/tracking-token-usage-in-foundation-models,
   https://help.openai.com/en/articles/4936856-what-are-tokens-and-how-to-count-them,
   https://zats.io/blog/making-the-most-of-apple-foundation-models-context-window/)
3. **Never register more than 3 tools in a worker session or 5 in any
   session; budget ~70 tokens per tool definition.** Apple's measured
   definition is ~68 tokens; degradation is documented past 10-15 tools.
   (https://artemnovichkov.com/blog/tracking-token-usage-in-foundation-models,
   https://tianpan.co/blog/2026-04-19-over-tooled-agent-problem)
4. **Load tool definitions just in time: the conductor picks the tool
   family, the worker sees only that family's schemas.** 6× lower prompt
   overhead on a 3B on-device agent. (https://arxiv.org/abs/2511.03728)
5. **Tool and parameter names are plain English words the model has seen
   (`searchCalendar`, `date`, `query`), never internal identifiers.**
   (https://arxiv.org/abs/2510.07248, https://www.anthropic.com/engineering/writing-tools-for-agents)
6. **Schemas are flat: primitives and enums only, no nested objects, no
   optional bags; use `@Guide`/Zod enums wherever the value set is closed.**
   (https://arxiv.org/abs/2412.16516, https://drobinin.com/consulting/foundation-models-apple-intelligence/putting-apple-foundation-models-in-a-real-app/)
7. **Every tool set includes an explicit no-tool path (`answerDirectly` or a
   `none` enum value) so irrelevance is a choice, not a hallucination.**
   (https://arxiv.org/abs/2410.04587)
8. **One tool call per worker step; a worker runs at most 3 steps before it
   must return.** 1B/3B multi-turn BFCL is 8-56% vs 80%+ single-turn.
   (https://arxiv.org/abs/2511.22138, https://arxiv.org/abs/2505.06120)
9. **Never request a schema-constrained final answer and tool calls in the
   same turn; do tool selection in one pass and structured output in the
   next.** (https://arxiv.org/abs/2606.25605)
10. **A worker brief has exactly four parts — objective, output format, tools,
    boundaries — and is the only input the worker receives; include the
    facts, do not reference them.**
    (https://www.anthropic.com/engineering/multi-agent-research-system,
    https://code.claude.com/docs/en/agent-sdk/subagents)
11. **Worker return is a `Generable`/Zod object ≤100 tokens with fields
    `result`, `decisions` (what it chose and why, one line), and `confidence`
    as a 3-5 value enum, not a number.** Verbalised confidence beats logprobs
    for RLHF models; decisions must travel because "actions carry implicit
    decisions". (https://aclanthology.org/2023.emnlp-main.330/,
    https://cognition.com/blog/dont-build-multi-agents)
12. **The conductor's context is: user ask + rolling summary + one line per
    completed step. Tool results never enter it.**
    (https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
13. **The conductor prompt carries a numeric effort table (e.g. lookup: 1
    worker, ≤2 tool calls; compose: 2-3 workers; anything projected past 6
    workers escalates).** (https://www.anthropic.com/engineering/multi-agent-research-system)
14. **Tools truncate at the source: default ≤300 tokens per result, with a
    `detail: "brief" | "full"` argument and a "truncated, N more" hint.**
    (https://www.anthropic.com/engineering/writing-tools-for-agents)
15. **Tool results are `key: value` lines or a pre-formatted sentence, never
    raw JSON; JSON only when the model must echo structure.**
    (https://drobinin.com/consulting/foundation-models-apple-intelligence/putting-apple-foundation-models-in-a-real-app/,
    https://tashif.codes/blog/JSON-YAML-LLM)
16. **Compression chain order is fixed and each stage must be individually
    measurable: (a) structural clearing of consumed tool results, (b)
    query-aware extractive selection with on-device embeddings, (c) model
    summary, (d) optional LLMLingua-2 only for payloads still over budget.**
    Tool-result clearing alone gave 29%; LLMLingua's overhead can negate gains.
    (https://claudelab.net/en/articles/api-sdk/compaction-api-context-management,
    https://arxiv.org/abs/2604.02985)
17. **The scribe compacts at 70% of budget and hard-flushes at 90%, folding
    the evicted half into a recursive summary whose prompt is tuned for
    recall first, then precision.** (https://ar5iv.labs.arxiv.org/html/2310.08560,
    https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
18. **The summary has fixed slots — goal, done, in-progress, decisions/
    constraints, next — and is injected into new sessions as instructions,
    not as a user message.** (https://gist.github.com/badlogic/cd2ef65b0697c4dbe2d13fbecb0a0a5f,
    https://zats.io/blog/making-the-most-of-apple-foundation-models-context-window/)
19. **All worker system prompts share one byte-identical prefix, prewarmed
    with `prewarm(promptPrefix:)` before the first user action.**
    (https://developer.apple.com/documentation/foundationmodels/languagemodelsession/prewarm(promptprefix:),
    https://medium.com/codex/make-your-foundation-llm-app-10-faster-on-ios-real-world-optimizations-38b6892132de)
20. **Memory is three tiers with hard sizes: core block ≤80 tokens pinned;
    episodic store of ≤1 sentence facts with `observedAt`/`invalidatedAt`
    and a 512-d embedding; a one-call ADD/UPDATE/DELETE/NOOP pass after each
    task.** (https://arxiv.org/abs/2310.08560, https://arxiv.org/abs/2504.19413,
    https://arxiv.org/abs/2501.13956)
21. **Escalate on structural signals, not vibes: 2 schema failures on the same
    step, 2 identical tool calls in a row, empty output, `guardrailViolation`,
    `unsupportedLanguageOrLocale`, or projected budget overrun; retry locally
    at most 3 times per task.** (https://github.com/NousResearch/hermes-agent/issues/15176,
    https://drobinin.com/consulting/foundation-models-apple-intelligence/putting-apple-foundation-models-in-a-real-app/)
22. **Escalation tiers are PCC first (`PrivateCloudComputeLanguageModel`,
    32K, check `isAvailable` and `quotaUsage.isLimitReached`) then the
    third-party cloud agent; the payload is the scribe's summary plus the
    current brief, never the transcript.** (https://developer.apple.com/videos/play/wwdc2026/319/,
    https://arxiv.org/abs/2305.05176)
23. **Write tools require confirmation before execution, expressed through
    the AI SDK's per-tool approval hook so the loop pauses rather than the
    tool refusing.** (https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent,
    https://openai.github.io/openai-agents-js/guides/agents/)
24. **Every fixture declares `ask`, seeded state, expected tool calls (name +
    partial args), expected end state, an answer rubric, an `escalation`
    expectation, and a budget; the suite reports pass^3 and the
    {local, escalated} × {pass, fail} matrix, run with greedy sampling.**
    (https://github.com/sierra-research/tau2-bench/blob/main/docs/evaluation.md,
    https://arxiv.org/abs/2406.12045, https://developer.apple.com/forums/thread/806542)
25. **Public API keeps AI SDK vocabulary (`instructions`, `tools`, `stopWhen`,
    `needsApproval`, `generate`/`stream`, `steps`) and adds only `budget`,
    `escalate`, and `compress`; the step loop lives above the provider because
    the Apple provider ignores `stopWhen`.**
    (https://ai-sdk.dev/providers/community-providers/react-native-apple,
    https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent)

## Sources

- Anthropic: https://www.anthropic.com/engineering/building-effective-agents · https://www.anthropic.com/engineering/multi-agent-research-system · https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents · https://www.anthropic.com/engineering/writing-tools-for-agents · https://code.claude.com/docs/en/agent-sdk/subagents · https://platform.claude.com/docs/en/build-with-claude/context-editing
- Cognition / LangChain / OpenAI: https://cognition.com/blog/dont-build-multi-agents · https://www.langchain.com/blog/how-and-when-to-build-multi-agent-systems · https://docs.langchain.com/oss/javascript/deepagents/subagents · https://developers.openai.com/cookbook/examples/orchestrating_agents · https://github.com/openai/swarm · https://openai.github.io/openai-agents-js/guides/agents/ · https://openai.github.io/openai-agents-js/guides/running-agents/
- Apple: https://developer.apple.com/forums/thread/806542 · https://developer.apple.com/forums/thread/797512 · https://developer.apple.com/documentation/FoundationModels/SystemLanguageModel/tokenCount(for:) · https://developer.apple.com/documentation/foundationmodels/languagemodelsession/prewarm(promptprefix:) · https://developer.apple.com/videos/play/wwdc2025/301/ · https://developer.apple.com/videos/play/wwdc2026/319/ · https://machinelearning.apple.com/research/apple-foundation-models-2025-updates · https://arxiv.org/abs/2507.13575 · https://security.apple.com/blog/private-cloud-compute/ · https://arxiv.org/html/2605.24239v1 · https://artemnovichkov.com/blog/tracking-token-usage-in-foundation-models · https://zats.io/blog/making-the-most-of-apple-foundation-models-context-window/ · https://drobinin.com/consulting/foundation-models-apple-intelligence/putting-apple-foundation-models-in-a-real-app/ · https://ivanmagda.dev/posts/wwdc26-foundation-models-year-two/ · https://medium.com/codex/make-your-foundation-llm-app-10-faster-on-ios-real-world-optimizations-38b6892132de
- Small-model tool calling: https://arxiv.org/abs/2511.22138 · https://arxiv.org/abs/2409.03215 · https://arxiv.org/abs/2410.04587 · https://huggingface.co/MadeAgents/Hammer2.1-1.5b · https://arxiv.org/abs/2412.16516 · https://arxiv.org/abs/2504.19277 · https://arxiv.org/abs/2510.07248 · https://arxiv.org/abs/2510.03847 · https://arxiv.org/abs/2606.25605 · https://arxiv.org/html/2505.09388v1 · https://gorilla.cs.berkeley.edu/leaderboard.html · https://arxiv.org/abs/2506.02153 · https://tianpan.co/blog/2026-04-19-over-tooled-agent-problem · https://medium.com/@minhle_0210/5-tiny-language-models-for-tool-calling-part-3-ebcda32c2518
- Compression / context: https://arxiv.org/abs/2403.12968 · https://huggingface.co/microsoft/llmlingua-2-xlm-roberta-large-meetingbank · https://arxiv.org/abs/2604.02985 · https://arxiv.org/abs/2511.03728 · https://arxiv.org/abs/1109.2128 · https://www.trychroma.com/research/context-rot · https://arxiv.org/abs/2505.06120 · https://gist.github.com/badlogic/cd2ef65b0697c4dbe2d13fbecb0a0a5f · https://claudelab.net/en/articles/api-sdk/compaction-api-context-management · https://www.react-native-ai.dev/docs/apple/embeddings · https://www.callstack.com/blog/on-device-ai-introducing-apple-embeddings-in-react-native · https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2 · https://www.npmjs.com/package/@react-native-rag/executorch · https://executorch.swmansion.com/ · https://github.com/shubham0204/model2vec.swift · https://help.openai.com/en/articles/4936856-what-are-tokens-and-how-to-count-them · https://blog.gopenai.com/counting-claude-tokens-without-a-tokenizer-e767f2b6e632 · https://tashif.codes/blog/JSON-YAML-LLM · https://medium.com/@ffkalapurackal/toon-vs-json-vs-yaml-token-efficiency-breakdown-for-llm-5d3e5dc9fb9c
- Memory: https://arxiv.org/abs/2310.08560 · https://ar5iv.labs.arxiv.org/html/2310.08560 · https://www.letta.com/blog/agent-memory/ · https://arxiv.org/abs/2504.19413 · https://arxiv.org/abs/2501.13956 · https://codepointer.substack.com/p/agent-memory-systems-and-knowledge
- Routing / escalation: https://arxiv.org/abs/2305.05176 · https://arxiv.org/abs/2406.18665 · https://www.lmsys.org/blog/2024-07-01-routellm/ · https://aclanthology.org/2023.emnlp-main.330/ · https://github.com/NousResearch/hermes-agent/issues/15176
- Evaluation: https://arxiv.org/abs/2406.12045 · https://github.com/sierra-research/tau2-bench/blob/main/docs/evaluation.md · https://arxiv.org/abs/2308.03688 · https://github.com/promptfoo/promptfoo/tree/main/examples/eval-tool-use · https://www.promptfoo.dev/docs/configuration/expected-outputs/deterministic/
- API shape: https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent · https://vercel.com/academy/filesystem-agents/agent-skeleton · https://ai-sdk.dev/providers/community-providers/react-native-apple · https://mastra.ai/docs/agents/overview · https://mastra.ai/docs/workflows/overview
