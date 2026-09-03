# Memory and retrieval that fit a phone and a 4k window

Research brief for Goliath (round 2), 2026-09-03. Scope: what an on-device
assistant driven by Apple's ~3B Foundation Model (4,096-token window, one
request in flight, guided JSON output, no logprobs) can remember, how it
should store and pick facts, and what a 3B writer can reliably produce.
Goliath today: `{ summary: string (≤60 words, slots Goal/Done/Decisions/
Pending/Next), recent: last 3 exchanges verbatim }` behind a key-value
adapter; the scribe folds an evicted exchange into the summary with one model
call; no retrieval, no vector store, no long-term facts beyond the brief.

Companion briefs this one builds on and does not repeat:
`../apple-foundation-models.md` (window, tool loop, guided generation),
`../small-context-agent-patterns.md` §3–4 (compression, MemGPT/Mem0/Zep at a
glance), `../harnesses/{grok-bot,hermes,mastra,claude-code}.md`.

The numbers that frame everything below:

| Constraint                    | Value                                                                                                                                                                                                                                                                                             | Source                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| On-device window, iOS 26.x    | "The on-device model has a context window of 4096 tokens"; `contextSize` / `tokenCount(for:)` arrived in iOS 26.4                                                                                                                                                                                 | [artemnovichkov](https://artemnovichkov.com/blog/tracking-token-usage-in-foundation-models)                                                      |
| On-device window, iOS 27      | 8192 on newer devices (`print(model.contextSize) // 8192`); "Apple's documentation still puts the on-device window at 4,096 tokens per session; the sessions hint at more on newer hardware, but the docs haven't committed"                                                                      | [WWDC26 241](https://developer.apple.com/videos/play/wwdc2026/241/), [ivanmagda](https://ivanmagda.dev/posts/wwdc26-foundation-models-year-two/) |
| Chars per token               | "3–4 characters per token" rule of thumb                                                                                                                                                                                                                                                          | [TN3193](https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window)                    |
| Fixed overhead                | ~400–800 tokens for instructions + 3–5 tools, leaving ~3,000 for transcript, tool output, answer                                                                                                                                                                                                  | `../apple-foundation-models.md` §Design rules #1                                                                                                 |
| Presence of context hurts ≤3B | "the difference between oracle and noisy distraction is _not significant_ for models below 7B (1.5B: p=0.26; 3B: p=0.07), suggesting that the _presence_ of any context—not its quality—drives the distraction effect"; noisy retrieval "destroyed correct answers at: 64% (1.5B) and 53.6% (3B)" | [Can Small LMs Use What They Retrieve?](https://arxiv.org/html/2603.11513)                                                                       |

That last row is the single most important finding for Goliath: on a 3B
model, every injected fact that is not needed is a distractor with a measured
cost, so memory must be gated, not merely ranked.

---

## 1. On-device embeddings

### 1.1 Apple `NLContextualEmbedding` (iOS 17+)

- What it is: "transformer-based contextual embeddings. Specifically, these
  are BERT embeddings"; "27 different languages ... three separate models,
  one each for groups of languages that share related writing systems ...
  Latin-script languages, one for languages that use Cyrillic, and one for
  Chinese, Japanese, and Korean"; assets "are downloaded as needed" and you
  can "request download before use" ([WWDC23 10042](https://developer.apple.com/videos/play/wwdc2023/10042/)).
  Latin 20 languages, Cyrillic 4, CJK 3 ([react-native-ai docs](https://www.react-native-ai.dev/docs/apple/embeddings)).
- Dimensions and length: "512-dimensional embeddings on iOS/tvOS/watchOS"
  and "768-dimensional embeddings on macOS" ([buh/NaturalLanguageEmbeddings](https://github.com/buh/NaturalLanguageEmbeddings));
  "produces 512-dimensional vectors and can process up to 256 tokens per
  request" ([Callstack blog](https://www.callstack.com/blog/on-device-ai-introducing-apple-embeddings-in-react-native)).
  `EmbeddingInfo` exposes `dimension`, `maximumSequenceLength`, `languages`,
  `scripts`, `modelIdentifier`, `revision` ([react-native-ai docs](https://www.react-native-ai.dev/docs/apple/embeddings)).
- Latency, measured by Callstack on **iPhone 16 Pro**: "Short (~10 tokens)
  19.19ms, Medium (~30 tokens) 21.53ms, Long (~90 tokens) 33.59ms"; "zero
  impact on your app's size" because assets live in Apple's system catalog
  ([react-native-ai docs](https://www.react-native-ai.dev/docs/apple/embeddings)).
  No published iPhone 15 / 17 numbers; expect the same order (the model is
  ANE-eligible; Apple's own ANE transformer article reports a distilbert at
  "an average latency of 3.47 ms at 0.454 W and 9.44 ms at 0.072 W" on
  iPhone 13 — a proxy for energy cost, not a measurement of this model
  ([Apple ML Research](https://machinelearning.apple.com/research/neural-engine-transformers))).
- Calling it from React Native:
  - `@react-native-ai/apple`: `apple.textEmbeddingModel({ language?: 'fr' })`
    implementing the AI SDK `EmbeddingModelV3`; use with `embed()` /
    `embedMany()`; direct API `AppleEmbeddings.prepare(language)`,
    `AppleEmbeddings.getInfo(language)`, `AppleEmbeddings.generateEmbeddings(values, language)`
    ([react-native-ai docs](https://www.react-native-ai.dev/docs/apple/embeddings)).
    Note the method is `textEmbeddingModel`, not `embeddingModel` as the
    ai-sdk.dev community page writes (`../rn-providers-and-ai-sdk.md`).
  - `expo-ai-kit`: `embed`, `getEmbeddingModelStatus`, `prepareEmbeddingModel`,
    `getSupportedEmbeddingLanguages`; iOS uses "Apple NLContextualEmbedding—
    zero-download, OS-maintained Latin, Cyrillic, and CJK script models";
    Android opt-in "EmbeddingGemma 300M through MediaPipe TextEmbedder—768
    dimensions, multilingual, CPU" (~25 MB in the APK plus a ~184 MB
    download); task hints `'semantic-similarity' | 'retrieval-query' |
'retrieval-document'`; "Every embedding result includes model: { id,
    revision }" and vectors are only comparable when the model identity
    matches ([expo-ai-kit README](https://github.com/saidkaban/expo-ai-kit/blob/main/README.md)).
- Quality: Apple publishes no MTEB-style numbers, and none exist for it on
  the leaderboard. The only independent evaluation found is buh's small
  corpus: "Precision@1: 1.00 (100%)", "Mean Reciprocal Rank: 0.83", with one
  important caveat for assistant text: "Single words show high baseline
  similarity (0.60-0.89 even for unrelated terms)", so queries must be
  phrases, and a similarity threshold of "0.85: Relevant results (recommended
  default)" ([buh/NaturalLanguageEmbeddings](https://github.com/buh/NaturalLanguageEmbeddings)).
  Treat thresholds as model-specific and calibrate them on Goliath's own
  fact corpus (see §4).

### 1.2 WWDC26: no new embedding API, but a retrieval tool

- Apple did not ship a public embedding API in Foundation Models. What it
  shipped is `SpotlightSearchTool`: "In one line, the tool is ready to search
  your app's Core Spotlight index"; "semantic search over text, to structured
  search over metadata, like dates, persons, locations"; "On-device models
  have a more restricted model context size, so it's best to use focused
  guidance for simpler search capabilities"; some donated metadata "is stored
  in a highly-compact representation that can be searched, but not recovered
  in a way that a language model can read it", so you implement
  `CSSearchableIndexDelegate.searchableItems(forIdentifiers:)` to hand items
  back ([WWDC26 246](https://developer.apple.com/videos/play/wwdc2026/246/)).
  Ivan Magda's summary: "local RAG with no embeddings pipeline, no vector
  store, and no server" ([ivanmagda](https://ivanmagda.dev/posts/wwdc26-foundation-models-year-two/)).
- It is a Swift `Tool` that runs inside `LanguageModelSession.respond`; a
  React Native provider would need to register it natively. Neither
  `@react-native-ai/apple` nor `expo-ai-kit` exposes it today
  (`../rn-providers-and-ai-sdk.md`). Keep it as a future adapter, not a
  dependency.

### 1.3 Alternatives that run on the phone

| Model                     | Params / size                                                                                           | Dims                                  | Quality                                                                                                                                                                                                                                                                                                | On-phone latency                                                                                                                                                                                                                                                   | Path from RN                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| all-MiniLM-L6-v2          | 22.7M, ~90 MB                                                                                           | 384                                   | MTEB avg 55.93 ([model2vec results](https://github.com/MinishLab/model2vec/blob/main/results/README.md))                                                                                                                                                                                               | "16" ms iPhone 17 Pro / 16 Pro, "19" ms iPhone SE 3, "54" ms Samsung S24 for "a sentence of around 80 tokens" ([RN ExecuTorch benchmarks](https://docs.swmansion.com/react-native-executorch/docs/0.5.x/benchmarks/inference-time))                                | `@react-native-rag/executorch` `ExecuTorchEmbeddings` ([README](https://github.com/software-mansion-labs/react-native-rag/blob/main/packages/executorch/README.md)) |
| multi-qa-MiniLM-L6-cos-v1 | same class                                                                                              | 384                                   | semantic search (6 datasets) 51.83 ([sbert](https://www.sbert.net/docs/sentence_transformer/pretrained_models.html))                                                                                                                                                                                   | "16" ms iPhone 17/16 Pro ([same](https://docs.swmansion.com/react-native-executorch/docs/0.5.x/benchmarks/inference-time))                                                                                                                                         | same                                                                                                                                                                |
| bge-small-en-v1.5         | 33.4M                                                                                                   | 384, seq 512                          | MTEB avg 62.17, Retrieval 51.68, STS 81.59 ([HF card](https://huggingface.co/BAAI/bge-small-en-v1.5))                                                                                                                                                                                                  | not benchmarked by SWM; same architecture class as MiniLM-L12                                                                                                                                                                                                      | needs own ExecuTorch/Core ML export                                                                                                                                 |
| EmbeddingGemma            | 308M ("roughly 100M model parameters and 200M embedding parameters"), "<200MB of RAM with quantization" | 768 → "128, 256, or 512" (Matryoshka) | "highest ranking open multilingual text embedding model under 500M" on MTEB ([Google blog](https://developers.googleblog.com/en/introducing-embeddinggemma/)); 61.15 multilingual v2 per [buildfastwithai](https://www.buildfastwithai.com/blogs/embeddinggemma-google-308m-on-device-embedding-model) | "<15ms embedding inference time (256 input tokens) on EdgeTPU" (not iPhone)                                                                                                                                                                                        | expo-ai-kit Android backend only; ~184 MB download                                                                                                                  |
| Model2Vec potion-base-8M  | 7.5M, "~8 MB on disk", "the smallest model on MTEB"                                                     | 256                                   | MTEB 51.08 = "91.96% of the performance of all-MiniLM-L6-v2" ([HF card](https://huggingface.co/minishlab/potion-base-8M), [results](https://github.com/MinishLab/model2vec/blob/main/results/README.md))                                                                                               | "up to 500 times faster on CPU than the original model" ([model2vec](https://github.com/MinishLab/model2vec)); it is "tokenize + lookup + pool operation instead of performing a forward-pass" ([model2vec.swift](https://github.com/shubham0204/model2vec.swift)) | Swift port exists (potion-base-32M = "32.7 MB"); a pure-JS port is a tokenizer + table lookup + mean pool, feasible in Hermes                                       |
| Model2Vec potion-base-32M | 32.3M, ~30 MB                                                                                           | 256                                   | MTEB 52.13, "93.21% of the performance of all-MiniLM-L6-v2"                                                                                                                                                                                                                                            | same                                                                                                                                                                                                                                                               | same                                                                                                                                                                |
| potion-multilingual-128M  | 128M, 101 languages, from bge-m3                                                                        | —                                     | "the best performing static embedding model for multilingual tasks" ([model2vec](https://github.com/MinishLab/model2vec))                                                                                                                                                                              | same                                                                                                                                                                                                                                                               | same                                                                                                                                                                |

Reading on short assistant text (tasks, events, notes): none of these models
has a published number on that exact domain. The closest proxies are STS
(short sentence pairs) and the multi-qa models trained on question/passage
pairs; bge-small's STS 81.59 vs MiniLM's ~78 (sbert family) suggests small
contextual models are all "good enough" for 10–30-token facts, and the
Model2Vec caveat — "these embeddings are not contextual i.e. the embedding of
a token does not depend on the tokens preceding it" — matters most for
negation and time ("not Tuesday" vs "Tuesday"), which is exactly the kind of
fact an assistant stores. Verdict: default to `NLContextualEmbedding` (no
download, 20–35 ms, OS-maintained), keep the vector's `{ modelIdentifier,
revision }` next to it, and treat Model2Vec-in-JS as the Android / iOS-16
fallback, not the primary.

---

## 2. Tiny vector stores on device

### 2.1 Brute force in JS

- expo-ai-kit's `createVectorStore` is "a linear scan over the records on
  each `search`. That's more than fast enough for the thousands-of-chunks
  scale typical of on-device RAG"; records are `Map<string, {id, vector:
number[], metadata}>`, `search(query, { topK = 10, minScore })` computes
  `cosineSimilarity` per record and sorts; persistence is `toJSON()` /
  `createVectorStore(snapshot)` ([src/rag.ts](https://github.com/saidkaban/expo-ai-kit/blob/main/src/rag.ts)).
- Reference cost: 5,000 × 512-d dot products = **2.27 ms/query** in Node
  v24 (V8 JIT, `Float32Array`, measured for this brief). Hermes is a
  bytecode interpreter ("converting the source code into bytecode at build
  time ... interprets it at runtime", [Callstack](https://www.callstack.com/insights/hermes-javascript-engine)),
  so expect 10–50× that — tens of ms at 5,000 facts, single-digit ms at 500. No published Hermes number exists; Goliath must measure (see change
  #9). buh's Swift scan over 768-d vectors: "500 items ~8ms, 1000 items
  ~15ms" on an M3 MacBook Air ([buh](https://github.com/buh/NaturalLanguageEmbeddings)).
- Practical ceiling for an assistant: Grok Bot caps what it even considers at
  `MEMORY_EXTRACTION_ARCHIVE_SCAN_LIMIT = 500`, renders at most
  `MEMORY_PROFILE_PROMPT_LIMIT = 100` profile lines and 30 recent under a
  4,000-char budget ([sand-memory.ts](https://github.com/dhanlon-intellica/grok-bot-0.18-reconstructed/blob/a9f633e0/source/host/runner/sand-memory.ts)).
  A year of daily use is low thousands of facts, which is brute-force
  territory everywhere: "You don't need approximate nearest neighbors
  algorithms until you're well past 100K vectors" ([sqlite-vec release](https://alexgarcia.xyz/blog/2024/sqlite-vec-stable-release/index.html)).

### 2.2 SQLite

- `sqlite-vec` brute-force numbers: SIFT1M (1M × 128-d) "sqlite-vec static
  ... 17ms query", vec0 "33ms"; 100K vectors "768 dims: Below 75ms", "3072
  dims: 214ms"; binary quantization "32x reduction" in storage at "5-10% loss
  of quality"; "Compiles on Android and theoretically on iOS" as of v0.1.0
  ([sqlite-vec release](https://alexgarcia.xyz/blog/2024/sqlite-vec-stable-release/index.html)).
  At Goliath's scale (≤10k × 512-d) that is single-digit ms.
- `expo-sqlite` bundles it: "add bundled sqlite-vec v0.1.6" behind
  `expo.sqlite.withSQLiteVecExtension`, loaded with
  `const extension = SQLite.bundledExtensions['sqlite-vec']; await db.loadExtensionAsync(extension.libPath, extension.entryPoint);`
  ([expo/expo#38693](https://github.com/expo/expo/pull/38693), [Expo SQLite docs](https://docs.expo.dev/versions/latest/sdk/sqlite/)).
  **Caveat:** in SDK 55 "The `vec.xcframework` file is absent from the npm
  package ... breaking sqlite-vec functionality on iOS despite configuring
  `withSQLiteVecExtension: true`"; workaround "Copy `vec.xcframework` from
  the SDK 54 package (`expo-sqlite@16.0.10`)" ([expo/expo#43455](https://github.com/expo/expo/issues/43455)).
  expo-sqlite also offers SQLCipher (`"useSQLCipher": true`, then
  `PRAGMA key = 'password'`; "not supported on Expo Go") ([Expo SQLite docs](https://docs.expo.dev/versions/latest/sdk/sqlite/)).
- `op-sqlite` flags: `sqliteVec` "enables sqlite-vec, an extension for RAG
  embeddings"; `sqlcipher` "encrypts all the database data with minimal
  overhead"; `iosSqlite` "cannot load extensions"; `libsql` backend gives
  native vectors (`F32_BLOB(n)`, `vector_distance_cos`, DiskANN via
  `libsql_vector_idx(emb, 'metric=cosine')`) ([op-sqlite install](https://op-engineering.github.io/op-sqlite/docs/installation/), [Turso docs](https://docs.turso.tech/features/ai-and-embeddings)).
  Software Mansion's `@react-native-rag/op-sqlite` uses the libsql route:
  "libsql already includes vector search capabilities, so sqliteVec is not
  needed" with `"op-sqlite": { "libsql": true }` ([README](https://github.com/software-mansion-labs/react-native-rag/blob/main/packages/op-sqlite/README.md)).
  Their note-taking demo retrieves `nResults: 1` and filters
  `r.similarity > 0.2` before prompting a LLaMA 3.2 1B ([SWM blog part 3](https://swmansion.com/blog/building-an-ai-powered-note-taking-app-in-react-native-part-3-local-rag-868ba75f818b)) — evidence that at 1–3B, one or two well-chosen chunks is the working regime.

### 2.3 MMKV, Core Data, SecureStore

- MMKV: mmap'd, "~30x faster than AsyncStorage", built-in AES-128/256 with
  "~5-10% slower" reads/writes and "~50-100ms" init; "Very large datasets
  (over 50MB) may cause memory pressure or slow startup" ([react-native-mmkv](https://github.com/margelo/react-native-mmkv), [netguru](https://www.netguru.com/blog/mmkv-react-native-storage)).
  Fine for the profile and brief (a few KB); a poor fit for thousands of
  512-float vectors (2 KB each → 10 MB for 5k, all in memory on open).
- Core Data: no vector type; you would store blobs and scan in Swift. Not
  reachable from the JS side without a native module; skip.
- `expo-secure-store`: "The size limit for a value in expo-secure-store is
  2048 bytes" ([Expo SecureStore docs](https://docs.expo.dev/versions/latest/sdk/securestore/)) — use it for the database key only.

### 2.4 Battery

No published per-embedding energy figure for `NLContextualEmbedding`. Apple's
ANE transformer article gives the scale for a same-size BERT: 3.47 ms at
0.454 W ≈ 1.6 mJ per inference ([Apple ML Research](https://machinelearning.apple.com/research/neural-engine-transformers)).
One embed per user turn plus one per fact written is negligible next to the
3B model's own generation; a full re-embed of 5k facts after a model-revision
change (~5k × 25 ms ≈ 2 min on one core) is the only job that should be
deferred to idle/charging.

---

## 3. Memory architectures that transfer

### 3.1 The catalogue, with what each writes and reads

| System                      | Write format (what the model emits)                                                                                                                                                                                                                                                                                                                                                                                                                               | Read format (what goes in context)                                                                                                                                              | Size discipline                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MemGPT/Letta                | function calls that "move data between main context and external context"; "Working context is a fixed-size read/write block of unstructured text, writeable only via MemGPT function calls" ([MemGPT](https://arxiv.org/html/2310.08560v2))                                                                                                                                                                                                                      | memory blocks "always visible - no retrieval needed", rendered with `chars_current` / `chars_limit` metadata ([Letta docs](https://docs.letta.com/guides/agents/memory-blocks)) | "When the prompt tokens exceed the 'warning token count' ... (e.g. 70% of the context window), the queue manager inserts a system message"; flush at 100%, evict "50% of the context window", recursive summary; default block `limit: int = 2000` chars ([MemGPT](https://arxiv.org/html/2310.08560v2), [letta#1731](https://github.com/letta-ai/letta/issues/1731))   |
| Mem0                        | extraction: JSON `{"facts": ["Name is John", "Is a Software engineer"]}` from "'m' = 10 previous messages" plus a summary; update: JSON `{"memory":[{"id","text","event": "ADD"                                                                                                                                                                                                                                                                                   | "UPDATE"                                                                                                                                                                        | "DELETE"                                                                                                                                                                                                                                                                                                                                                                | "NONE","old_memory"}]}` against "top s semantically similar memories ... s = 10" ([prompts.py](https://github.com/mem0ai/mem0/blob/main/mem0/configs/prompts.py), [paper](https://arxiv.org/html/2504.19413)) | retrieved facts as plain lines                                                                                                                                                 | LoCoMo J 67.13 single-hop, 51.15 multi-hop, 55.51 temporal; "~7k tokens per conversation" vs 26,031 full-context; search p95 0.200 s ([paper](https://arxiv.org/html/2504.19413))                                                                                                                                                                                                      |
| Zep/Graphiti                | LLM-extracted edges with four times: "t′created and t′expired ... monitor when facts are created or invalidated in the system, while tvalid and tinvalid ... track the temporal range during which facts held true"; "When the system identifies temporally overlapping contradictions, it invalidates the affected edges by setting their tinvalid to the tvalid of the invalidating edge" ([Zep paper](https://arxiv.org/html/2501.13956v1))                    | facts + dates; three retrievers "φcos, φbm25, φbfs"                                                                                                                             | DMR "94.8% accuracy with gpt-4-turbo"; LongMemEval "+15.2%" (gpt-4o-mini); context "1.6k" tokens vs "115k" baseline                                                                                                                                                                                                                                                     |
| Mastra working memory       | agent calls `updateWorkingMemory` to rewrite a markdown template: `# User Information` with `- **First Name**:`, `**Location**`, `**Occupation**`, `**Interests**`, `**Goals**`, `**Events**`, `**Facts**`, `**Projects**` ([memory.ts](https://github.com/mastra-ai/mastra/blob/main/packages/core/src/memory/memory.ts)); or a zod schema with `timezone`, `preferences.communicationStyle`, `deadlines` ([docs](https://mastra.ai/docs/memory/working-memory)) | the whole template every turn                                                                                                                                                   | "Keep labels brief", "Abbreviate very long values"                                                                                                                                                                                                                                                                                                                      |
| Mastra observational memory | Observer writes dated "two-level bulleted lists" with "🔴 high, 🟡 medium, 🟢 low"; Reflector condenses                                                                                                                                                                                                                                                                                                                                                           | the append-only observation log replaces history                                                                                                                                | Observer at "30,000" tokens, Reflector at "40,000"; "3–6× compression" on text; 94.87% LongMemEval with gpt-5-mini; "Mastra recommends using a model that has a large context window (128K+ tokens)" ([docs](https://mastra.ai/docs/memory/observational-memory), [research](https://mastra.ai/research/observational-memory))                                          |
| Claude Code auto memory     | markdown topic files with YAML frontmatter `type: user                                                                                                                                                                                                                                                                                                                                                                                                            | feedback                                                                                                                                                                        | project                                                                                                                                                                                                                                                                                                                                                                 | reference`; "Claude skips anything it can derive from the codebase"                                                                                                                                           | `MEMORY.md` index, "one line per memory", "first 200 lines ... or the first 25KB"; topic files "loaded on demand" ([Claude Code docs](https://code.claude.com/docs/en/memory)) | over-limit write returns an error telling Claude to rewrite the index                                                                                                                                                                                                                                                                                                                  |
| Grok Bot                    | line grammar: `"profile: <fact>", "log: <fact>", or "note: <fact>" to add ... or "remove: <existing fact>"`, `Output exactly NONE`; parser `^(profile                                                                                                                                                                                                                                                                                                             | log                                                                                                                                                                             | note                                                                                                                                                                                                                                                                                                                                                                    | remove)\s*:\s*(.+)$` after stripping bullets; content capped at 500 chars, deduped on lowercase                                                                                                               | `About the user:` then `- (learned YYYY-MM-DD) <fact>` lines; `Recently:` under a 4,000-char budget with `(N more log facts not shown.)`                                       | rank `log2(importance) + createdAt / (30 days)`, importance 1.5 `[episode]`, 0.5 `[note]`, else 1; trivial exchanges skipped (≤40 chars, no `?`, in a stop set); episodes every 6 turns as "ONE short journal-style sentence" with absolute dates ([sand-memory.ts](https://github.com/dhanlon-intellica/grok-bot-0.18-reconstructed/blob/a9f633e0/source/host/runner/sand-memory.ts)) |
| Hermes                      | tool calls `add` / `replace` / `remove` on `§`-delimited entries                                                                                                                                                                                                                                                                                                                                                                                                  | `MEMORY (your personal notes) [67% — 1,474/2,200 chars]` then entries; "captured once at session start and never changes mid-session"                                           | `memory_char_limit = 2200` ("~800 tokens"), `user_char_limit = 1375` ("~500 tokens"); overflow "returns an error instead of silently dropping entries. The agent then makes room itself" ([memory_tool.py](https://github.com/NousResearch/hermes-agent/blob/main/tools/memory_tool.py), [docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory)) |

### 3.2 What a 3B model can _write_ reliably

Ranked by how much the format asks of the model:

1. **A line grammar with a `NONE` sentinel** (Grok Bot) asks the least: one
   tag word, a colon, a sentence. The parser tolerates bullets and
   numbering and ignores anything that does not match. Removal is the weak
   spot — `remove: <exact existing fact>` requires reproducing a string
   verbatim, and Grok Bot guards it with "Only remove facts that appear
   verbatim in the existing list — never invent removals" plus a dedupe-key
   match on apply.
2. **Guided JSON with a flat schema** is the same grammar with a structural
   guarantee. Apple's constrained decoding "works by masking out the tokens
   that are not valid" (`../apple-foundation-models.md` §4), and dynamic
   schemas support `anyOf` over runtime strings, so `remove` can be an enum
   of the ids currently shown. The remaining risk is semantic (wrong id,
   invented fact), which HaluMem shows is where systems fail: "existing
   memory systems tend to generate and accumulate hallucinations during the
   extraction and updating stages, which subsequently propagate errors to
   the question answering stage" ([HaluMem](https://arxiv.org/abs/2511.03506)).
3. **Mem0's two-call JSON** (extract facts → decide ADD/UPDATE/DELETE/NONE
   per fact with ids and `old_memory`) doubles the model calls and asks the
   writer to reason over 10 candidates × 10 neighbours. Two calls on a
   single-request-in-flight device means the user waits.
4. **Rewriting a markdown template** (Mastra working memory) makes the model
   re-emit every slot each time; a 3B model drops or garbles slots it did
   not change, and the whole template is tokens on every turn.
5. **Hermes-style tool calls** work only if the harness already has a tool
   loop with the memory tool registered — on Apple the tool loop runs inside
   `respond` and every tool definition costs window (`../apple-foundation-models.md`).

Evidence that small models can do (1)–(2) when the task is narrow:
MemReader trains "MemReader-0.6B" and "MemReader-4B" extractors that
"selectively write memories, defer incomplete inputs, retrieve historical
context, or discard irrelevant chatter" and reach state of the art on
"knowledge updating, temporal reasoning, and hallucination reduction"
([MemReader](https://arxiv.org/abs/2604.07877)). DuoMem shows the flip side:
an untrained 4B agent scored "4.3%" on a memory-dependent task before
distillation, "77.9%" after ([DuoMem](https://arxiv.org/abs/2606.29961)).
Apple's model is not fine-tunable by Goliath (adapters are an entitlement-
gated, per-OS path — `../apple-foundation-models.md` §Adapters), so the
prompt and grammar must do the narrowing: one tag, one sentence, absolute
dates, explicit `NONE`.

### 3.3 What a 3B model can _read_ usefully in ≤200 tokens

- Flat dated lines (`- (learned 2026-08-30) The user's name is Ian`) cost
  ~12–20 tokens each; 8–10 of them fit in 200 tokens. Mastra's emoji
  priority markers and two-level nesting, Claude Code's index-plus-file
  indirection, and Letta's `<memory_blocks>` XML with metadata all spend
  tokens on structure a 3B model does not exploit.
- Position matters more for small models than for large ones: "the smallest
  Llama-2 models (7B) are solely recency-biased ... only the larger models
  (13B and 70B) exhibit the U-shaped performance curve" ([Lost in the Middle](https://arxiv.org/html/2307.03172)).
  So injected facts belong at the _end_ of the prompt, right before the
  user's message, not in the system preamble.
- Fewer is better: "Even a single distractor reduces performance relative to
  the baseline (needle only), and adding four distractors compounds this
  degradation further" ([Chroma](https://www.trychroma.com/research/context-rot)).
- The user-facts benchmark ceiling is low even for frontier models:
  PersonaMem reports "only around 50% overall accuracy" on tracking
  evolving preferences across "up to 60 sessions" ([PersonaMem](https://arxiv.org/abs/2504.14225));
  LongMemEval finds "a 30% accuracy drop on memorizing information across
  sustained interactions" and recommends "session decomposition ...
  fact-augmented key expansion ... time-aware query expansion" ([LongMemEval](https://arxiv.org/abs/2410.10813)).
  For a 3B reader, the design goal is not to win these benchmarks but to
  never lose a fact the user stated explicitly.

---

## 4. Query-aware selection for the brief

- Why not positional truncation: Chroma's LongMemEval experiment contrasts
  "Focused prompts average to ~300 tokens" with full histories that "mostly
  consist of content irrelevant to the question, and sometimes distractors",
  and finds "significantly higher performance on focused prompts compared to
  full prompts" on every model; "as needle-question similarity decreases,
  model performance degrades more significantly with increasing input
  length" (their cosine range "0.445-0.775" on essays) ([Chroma](https://www.trychroma.com/research/context-rot)).
  RECOMP's extractive compressor — "selects useful sentences from retrieved
  documents" — reaches "5% tokens while losing 2 EM points" on NQ, and "The
  extractive oracle outperforms the abstractive one in all datasets"
  ([RECOMP](https://arxiv.org/abs/2310.04408)): selecting verbatim sentences
  beats summarising them when the selector is good.
- Algorithms that fit a phone:
  - Cosine-to-ask over fact embeddings (one embed of the latest user message
    per turn, ~20–35 ms; one dot product per fact). This is Mem0's
    retrieval, Grok Bot's `selectRelevantMemories` (token-overlap variant:
    `[\p{L}\p{N}]{4,}` tokens minus stopwords, ranked by overlap then
    `createdAt`, capped at 10) done with vectors instead of words
    ([sand-memory.ts](https://github.com/dhanlon-intellica/grok-bot-0.18-reconstructed/blob/a9f633e0/source/host/runner/sand-memory.ts)).
  - LexRank (eigenvector centrality over a cosine graph, [Erkan & Radev](https://arxiv.org/abs/1109.2128))
    is for choosing representative sentences _without_ a query — useful
    when the scribe compacts, not when it injects. A 2026 training-free
    variant builds "a sparse hybrid sentence graph that combines mutual k-NN
    semantic edges with short-range sequential edges" and ranks by "task
    relevance, cluster representativeness, and centrality"
    ([arXiv 2604.23277](https://arxiv.org/abs/2604.23277)); at Goliath's
    sizes (≤10 facts per turn) the graph step is not worth its code.
  - Gate, then rank: because for ≤3B "context presence, not quality, drives
    distraction" and noisy context "destroyed correct answers at ... 53.6%
    (3B)" ([Can Small LMs Use What They Retrieve?](https://arxiv.org/html/2603.11513)),
    apply a similarity floor first and inject _nothing_ below it. The
    paper's own recommendation: "using retrieval only when the model is
    likely to lack the answer (adaptive retrieval)".
- Verbatim vs paraphrase: there is no controlled study on a 3B model reading
  paraphrased vs verbatim in-context facts. The adjacent evidence all points
  one way: NoLiMa shows that once "models can exploit existing literal
  matches" is taken away, "11 models drop below 50% of their strong
  short-length baselines" at 32K ([NoLiMa](https://arxiv.org/abs/2502.05167));
  on parametric recall, "average accuracy dropped from 0.615 on original
  questions to 0.545 on indirect-reference variants—a drop of 7.0 percentage
  points", up to "−19.8 pp" in some domains, across six frontier models
  ([arXiv 2603.16197](https://arxiv.org/html/2603.16197v1)); and Chroma's
  needle-question similarity result is the same effect in-context. Store the
  user's own words (Grok Bot's rule: the Goal slot "should hold the request
  verbatim, not a paraphrase", `../harnesses/grok-bot.md` #10) and let the
  scribe normalise only dates and pronouns.

---

## 5. Personal-assistant specifics

### 5.1 What facts an assistant actually needs

Union of what the shipped systems ask their writers to keep:

- Mem0's extraction categories: "Personal Preferences ... Important Personal
  Details: ... names, relationships, and important dates ... Plans and
  Intentions: ... upcoming events, trips, goals ... Activity and Service
  Preferences ... Health and Wellness ... Professional Details: ... job
  titles, work habits ... Miscellaneous" ([prompts.py](https://github.com/mem0ai/mem0/blob/main/mem0/configs/prompts.py)).
- Grok Bot's `profile` tier: "their name and how to address them, role,
  location, languages, lasting preferences and constraints, and important
  people or relationships"; `log`: "ongoing projects and tasks, decisions,
  commitments, and time-bound details" ([sand-memory.ts](https://github.com/dhanlon-intellica/grok-bot-0.18-reconstructed/blob/a9f633e0/source/host/runner/sand-memory.ts)).
- Mastra's schema example: `name, location, timezone, preferences.communicationStyle, projectGoal, deadlines` ([docs](https://mastra.ai/docs/memory/working-memory)).
- Claude Code's four types: `user` (role, expertise, preferences), `feedback`
  (corrections and confirmed approaches), `project` (ongoing work,
  deadlines, decisions), `reference` ([Claude Code docs](https://code.claude.com/docs/en/memory)).
- Apple's Siri examples of personal context: recognising "who 'Mom' is" and
  finding "flight information" ([Wing VC](https://www.wing.vc/content/unpacking-apple-intelligence-apples-vision-for-personalized-ai)).

For Helen-class use (tasks, events, notes), the pinned slots are: timezone
and locale, working hours / quiet hours, name and how to be addressed, the
handful of people who recur (with relationship), recurring commitments
(standing meetings, school run), and standing preferences (default meeting
length, "never schedule before 9"). Everything else is a dated fact in the
store.

### 5.2 How Siri and Google model user context

- Apple: "Entity schemas contribute your content to the Spotlight semantic
  index for personal context understanding" ([WWDC24 10133](https://developer.apple.com/videos/play/wwdc2024/10133/));
  "When you do this, your app's entities are indexed into the system
  semantic index. This allows Siri to match based on meaning, not just text,
  understand relationships between entities, and even answer questions over
  your content" via `IndexedEntity` with `@Property(indexingKey:)`
  ([WWDC26 240](https://developer.apple.com/videos/play/wwdc2026/240/)).
  Privacy: "When possible, Apple Intelligence models run entirely on device
  so that a task can be completed without data leaving your device"; PCC
  data "is not stored or made accessible to Apple" ([Apple legal](https://www.apple.com/legal/privacy/data/en/intelligence-engine/)).
  The model of "user context" is therefore an on-device index of app
  entities the assistant queries, not a profile the assistant writes.
- Google: Personal Intelligence connects "Gmail, Photos, YouTube and Search
  in a single tap"; "Connecting your apps is off by default: you choose to
  turn it on, decide exactly which apps to connect, and can turn it off
  anytime"; Google "doesn't train directly on your Gmail inbox or Google
  Photos library" ([Google blog](https://blog.google/innovation-and-ai/products/gemini-app/personal-intelligence/)).
  Gemini's memory is cloud-side: "Memory ... lets Gemini learn from your
  past chats", "Saved info holds facts and instructions you state
  explicitly" ([memoryplugin](https://blog.memoryplugin.com/how-gemini-memory-works/)).
  The model is cloud retrieval over the user's own accounts, opt-in per
  source.
- Where Goliath sits: Apple's shape (index the user's data, query it) is the
  right long-term direction via `SpotlightSearchTool`; until a RN provider
  exposes it, Goliath's own fact store is the substitute, and it should
  mirror Google's controls (per-source opt-in, visible, deletable) without
  the cloud.

### 5.3 Privacy-preserving storage

- iOS Data Protection classes: `NSFileProtectionComplete` — "The class key
  is protected with a key derived from the user passcode or password and the
  device UID"; `NSFileProtectionCompleteUntilFirstUserAuthentication` — "the
  default class for all third-party app data not otherwise assigned"
  ([Apple Platform Security](https://support.apple.com/guide/security/data-protection-classes-secb010e978a/web)).
  Neither expo-sqlite nor op-sqlite sets a class for you; a memory database
  written from JS lands in class C unless the native side applies
  `NSFileProtectionComplete` (or `CompleteUnlessOpen`, since the scribe may
  write while the phone is locked in a background task).
- Encryption at rest beyond the file class: expo-sqlite `useSQLCipher` +
  `PRAGMA key`, op-sqlite `sqlcipher`, MMKV AES ([Expo SQLite docs](https://docs.expo.dev/versions/latest/sdk/sqlite/), [op-sqlite](https://op-engineering.github.io/op-sqlite/docs/installation/), [react-native-mmkv](https://github.com/margelo/react-native-mmkv)).
  The key belongs in the Keychain via `expo-secure-store` (≤2048 bytes —
  the key, never the data) ([Expo SecureStore docs](https://docs.expo.dev/versions/latest/sdk/securestore/)).
- No cloud sync of memory: keep the store out of iCloud backup
  (`isExcludedFromBackup` on the file URL), never ship it in telemetry, and
  expose `list / forget(id) / forgetAll / export` so the user can audit it,
  the way Claude Code's memory is "plain markdown you can read, edit, or
  delete" ([Claude Code docs](https://code.claude.com/docs/en/memory)) and
  Google's is disconnectable "anytime".

---

## What Goliath should change

Each item: the change, the test that proves it, the source.

1. **Three tiers: `profile` (pinned), `facts` (retrieved), `brief` (existing).**
   Keep `summary` + `recent` as they are; add a pinned profile of ≤8 slots
   and a fact store. Render order in the prompt: instructions → profile →
   brief → recent → _selected facts_ → user message.
   _Test:_ rendered memory ≤ 300 tokens by `tokenCount(for:)` on every turn
   of a 200-turn synthetic session.
   _Source:_ MemGPT core/recall/archival ([paper](https://arxiv.org/html/2310.08560v2)); Grok Bot `profile` vs `log` ([sand-memory.ts](https://github.com/dhanlon-intellica/grok-bot-0.18-reconstructed/blob/a9f633e0/source/host/runner/sand-memory.ts)); Hermes MEMORY/USER split ([docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory)).

2. **Put selected facts last, not first.**
   _Test:_ a fact-recall eval (30 questions) scores higher with facts placed
   immediately before the user message than in the system preamble; keep
   the better position, but the test must exist.
   _Source:_ 7B "solely recency-biased" ([Lost in the Middle](https://arxiv.org/html/2307.03172)); primacy weakens past 50% of window ([arXiv 2508.07479](https://arxiv.org/html/2508.07479v1)).

3. **Gate injection with a similarity floor before ranking.** Inject 0–5
   facts; 0 is the common case.
   _Test:_ on a held-out set of 100 user messages with no relevant fact,
   ≥95% of turns inject nothing; on 100 with a planted fact, recall@5 ≥ 0.9.
   Calibrate the floor per embedding `modelIdentifier`+`revision` (buh's
   0.85 is a starting point for NLContextualEmbedding, not a constant).
   _Source:_ "presence of any context—not its quality—drives the distraction effect" ([arXiv 2603.11513](https://arxiv.org/html/2603.11513)); single distractor hurts ([Chroma](https://www.trychroma.com/research/context-rot)); buh thresholds ([repo](https://github.com/buh/NaturalLanguageEmbeddings)).

4. **Rank = cosine-to-ask, tie-broken by Grok Bot's decay score.**
   `score = cos(q, f) + λ · (log2(importance) + observedAt/30d)` with λ small,
   and never inject a fact with `invalidatedAt` set.
   _Test:_ two facts with equal cosine → newer wins; an invalidated fact is
   never selected even at cosine 0.99.
   _Source:_ [sand-memory.ts](https://github.com/dhanlon-intellica/grok-bot-0.18-reconstructed/blob/a9f633e0/source/host/runner/sand-memory.ts) `memoryRecallRank`; Zep `tinvalid` ([paper](https://arxiv.org/html/2501.13956v1)).

5. **Write facts with a guided flat schema that mirrors the line grammar**
   (below), with `remove` constrained to ids on screen via `anyOf`, and
   `NONE` expressed as an empty `ops` array. Accept the plain line grammar
   as the fallback when the provider has no guided generation.
   _Test:_ 200 recorded 3B outputs parse with zero exceptions; every
   `remove` names an id that exists; no op text exceeds 200 chars.
   _Source:_ Grok Bot grammar and parser ([sand-memory.ts](https://github.com/dhanlon-intellica/grok-bot-0.18-reconstructed/blob/a9f633e0/source/host/runner/sand-memory.ts)); Apple constrained decoding and dynamic `anyOf` (`../apple-foundation-models.md` §4); HaluMem on extraction/update hallucination ([abs](https://arxiv.org/abs/2511.03506)).

6. **Extract at episode boundaries, not every turn.** Run the fact writer
   when the scribe already runs (an exchange is evicted), every 6 exchanges,
   or on `AppState` background — never between a user message and the reply.
   Skip trivial exchanges with Grok Bot's rule.
   _Test:_ in a 20-turn session the writer runs ≤4 times; `hi` / `thanks`
   never trigger it; the user-visible turn latency is unchanged versus
   memory off.
   _Source:_ `DEFAULT_EPISODE_INTERVAL = 6`, `isMemorableExchange` ([sand-memory.ts](https://github.com/dhanlon-intellica/grok-bot-0.18-reconstructed/blob/a9f633e0/source/host/runner/sand-memory.ts)); one request in flight (`../apple-foundation-models.md`).

7. **Show the writer the nearest existing facts, with ids.** Before the
   write call, retrieve the top-10 facts by cosine to the exchange (Mem0's
   `s = 10`) plus all profile slots, render as `f1: ...` lines, and let the
   writer emit `remove`/`replace` against those ids only.
   _Test:_ "I moved to Lisbon" with an existing `f3: Lives in Porto` yields
   `remove f3` + `profile: Lives in Lisbon`; a contradiction with no listed
   neighbour yields an add, never an invented remove.
   _Source:_ Mem0 update phase ([paper](https://arxiv.org/html/2504.19413)); Grok Bot "never invent removals".

8. **Store the user's words and absolute dates.** Facts are the user's
   sentence with pronouns normalised ("The user ...") and relative dates
   resolved against the exchange timestamp; no summarising.
   _Test:_ a planted fact "dentist Tuesday 3pm" stored on a Friday reads
   `... on 2026-09-08 15:00`; string similarity between stored fact and the
   user's sentence ≥ 0.8.
   _Source:_ Grok Bot episode prompt "never relative words like 'yesterday'"; NoLiMa literal-match dependence ([abs](https://arxiv.org/abs/2502.05167)); RECOMP extractive > abstractive oracle ([abs](https://arxiv.org/abs/2310.04408)).

9. **Embedding provider = AI SDK `EmbeddingModelV3`, default Apple, with
   model identity stored per vector.** `apple.textEmbeddingModel()` on
   iOS 17+; `{ modelIdentifier, revision, dimension }` saved with each
   vector; on mismatch, facts are re-embedded lazily (on idle) and matched
   by lexical overlap until then. Ship a lexical fallback (Grok Bot's
   token-overlap selector) for devices with no embedding model.
   _Test:_ `embedMany` of 50 facts on an iPhone 15 completes < 2 s; a
   revision change triggers re-embed of every row without a user-visible
   stall; with embeddings disabled, retrieval still returns overlap matches.
   _Source:_ [react-native-ai docs](https://www.react-native-ai.dev/docs/apple/embeddings) (19–34 ms/embed); expo-ai-kit `model: { id, revision }` ([README](https://github.com/saidkaban/expo-ai-kit/blob/main/README.md)); `selectRelevantMemories` ([sand-memory.ts](https://github.com/dhanlon-intellica/grok-bot-0.18-reconstructed/blob/a9f633e0/source/host/runner/sand-memory.ts)).

10. **Vector index = brute force over a `Float32Array` in JS, behind an
    adapter interface; sqlite-vec is an optional adapter.** Default keeps
    all vectors in one contiguous `Float32Array(n × d)` rebuilt on load;
    the `VectorIndex` interface lets a host swap in expo-sqlite + sqlite-vec
    or op-sqlite/libsql.
    _Test:_ benchmark script in the repo; 5,000 × 512-d query < 50 ms on
    Hermes on an iPhone 15 (Node reference 2.27 ms); above that, the docs
    tell the host to use the SQLite adapter.
    _Source:_ expo-ai-kit linear scan ([rag.ts](https://github.com/saidkaban/expo-ai-kit/blob/main/src/rag.ts)); sqlite-vec numbers ([release](https://alexgarcia.xyz/blog/2024/sqlite-vec-stable-release/index.html)); expo-sqlite vec (with the SDK 55 iOS caveat, [#43455](https://github.com/expo/expo/issues/43455)).

11. **Show the budget to the writer and refuse over-budget writes.** The
    profile has a hard byte cap (600 chars); the write call sees
    `PROFILE [412/600 chars]`; an over-cap result is rejected and the writer
    is re-run once with "consolidate" appended.
    _Test:_ a ninth profile slot cannot be added without a `remove`; the
    retry path is exercised in a unit test.
    _Source:_ Hermes `[67% — 1,474/2,200 chars]` and error-on-overflow ([docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory)); Letta `chars_current`/`chars_limit` ([docs](https://docs.letta.com/guides/agents/memory-blocks)).

12. **Freeze the rendered memory block per compaction epoch.** Profile and
    brief text are rendered once and reused byte-for-byte until the scribe
    runs; only the selected-facts block changes per turn.
    _Test:_ two renders in the same epoch are identical strings.
    _Source:_ Grok Bot `resolveFrozenMemoryPrompt` ([sand-memory.ts](https://github.com/dhanlon-intellica/grok-bot-0.18-reconstructed/blob/a9f633e0/source/host/runner/sand-memory.ts)); Mastra on stable prefixes and cache hit rates ([research](https://mastra.ai/research/observational-memory)).

13. **On-device only, protected, auditable.** The store file gets
    `NSFileProtectionCompleteUnlessOpen`, is excluded from backup, and the
    API exposes `memory.list()`, `memory.forget(id)`, `memory.forgetAll()`,
    `memory.export()`. Encryption at rest is the host's SQLCipher/MMKV
    choice; Goliath documents it and never sends memory anywhere.
    _Test:_ the file's protection attribute is asserted in an iOS
    integration test; `forget(id)` removes the row and its vector; no
    network call originates from the memory module (mock fetch, assert zero).
    _Source:_ [Apple Platform Security](https://support.apple.com/guide/security/data-protection-classes-secb010e978a/web); [Expo SQLite docs](https://docs.expo.dev/versions/latest/sdk/sqlite/); Google's "off by default ... turn it off anytime" ([blog](https://blog.google/innovation-and-ai/products/gemini-app/personal-intelligence/)).

14. **Ship a memory eval, not just unit tests.** A LongMemEval-style set of
    ~50 questions over synthetic assistant histories (tasks, events, people),
    scored three ways: recall with injection, "answers destroyed" with
    injection (the 53.6% number), and extraction precision against gold
    facts (HaluMem's extraction/update split).
    _Test:_ the eval runs in CI against a recorded-output fixture and on
    device by a script; regressions in any of the three fail the build.
    _Source:_ [LongMemEval](https://arxiv.org/abs/2410.10813); [arXiv 2603.11513](https://arxiv.org/html/2603.11513); [HaluMem](https://arxiv.org/abs/2511.03506).

15. **Plan for `SpotlightSearchTool` as a native adapter.** When a RN
    provider exposes it, Goliath's `memory` can donate facts as
    `CSSearchableItem`s and let the on-device model query them instead of
    Goliath ranking. Do not build on it now.
    _Source:_ [WWDC26 246](https://developer.apple.com/videos/play/wwdc2026/246/).

### Proposed `MemoryState` v2

```ts
type EmbeddingIdentity = { modelIdentifier: string; revision: number; dimension: number };

type ProfileSlot =
  | "name"
  | "timezone"
  | "locale"
  | "workingHours"
  | "people"
  | "recurring"
  | "preferences"
  | "constraints";

type Fact = {
  id: string; // short, stable: "f3"
  text: string; // user's words, ≤200 chars, absolute dates
  kind: "profile" | "log" | "note";
  importance: 0.5 | 1 | 1.5; // note / fact / episode, Grok Bot weights
  observedAt: number; // ms epoch of the exchange it came from
  invalidatedAt?: number; // soft delete; never injected once set
  supersededBy?: string; // id of the replacing fact
  source: "user" | "scribe"; // user-stated vs inferred
  embedding?: Float32Array; // optional; absent until embedded
  embeddedWith?: EmbeddingIdentity;
};

type MemoryState = {
  version: 2;
  profile: Partial<Record<ProfileSlot, string>>; // ≤ 600 chars total
  brief: { summary: string; recent: Exchange[] }; // unchanged from v1
  facts: Fact[]; // the store; adapter-backed
  epoch: number; // compaction epoch for frozen renders
  rendered?: { profileAndBrief: string; epoch: number };
};

interface VectorIndex {
  upsert(id: string, v: Float32Array): void;
  remove(id: string): void;
  search(q: Float32Array, k: number, floor: number): Array<{ id: string; score: number }>;
}
```

The v1 shape is a strict subset (`brief` carries `summary` and `recent`), so
a v1 record loads as v2 with `profile = {}` and `facts = []`.

### Extraction prompt and grammar for a 3B writer

Guided schema (Apple path), kept flat and short because every field
description is prompt tokens:

```ts
// ops: maximumCount(5). `remove` is a DynamicGenerationSchema anyOf over the ids shown.
{
  ops: Array<{ op: "profile" | "log" | "note" | "remove"; text: string }>;
}
```

Line grammar (fallback, and the shape the model is shown as examples):

```
profile: <fact>
log: <fact>
note: <fact>
remove: <id>
NONE
```

Parser: strip leading bullets/numbers, match
`^(profile|log|note|remove)\s*:\s*(.+)$` case-insensitively, cap text at 200
chars, dedupe on lowercase-normalised text, ignore unmatched lines; `remove`
must name an id from the shown list or it is dropped.

Prompt (≈180 tokens of instructions; the exchange and neighbours add
~150–250):

```
You keep the long-term memory of a personal assistant. Today is {ISO date}.
Read the latest exchange. Decide what is worth remembering in future,
unrelated conversations. Write each item on its own line:
profile: <who the user is, how to address them, timezone, working hours, people, lasting preferences>
log: <a task, event, decision, or commitment, with the absolute date>
note: <a minor detail>
remove: <id of a listed fact this exchange contradicts>
Use the user's own words. Write dates as YYYY-MM-DD. Do not record what the
assistant did, general knowledge, or anything already listed.
Output exactly NONE if there is nothing to add or remove.

Listed facts:
f1: ...
f2: ...

Latest exchange:
User: ...
Assistant: ...
```

### Per-turn injection budget (4,096-token device)

| Block                                                          | Cap                              | Typical  |
| -------------------------------------------------------------- | -------------------------------- | -------- |
| Profile (≤8 slots, 600 chars)                                  | 150 tokens                       | 60–100   |
| Brief summary (existing, ≤60 words)                            | 90 tokens                        | 80       |
| Selected facts (0–5 × ≤25 tokens, with `(learned YYYY-MM-DD)`) | 125 tokens                       | 0–75     |
| Headers/labels                                                 | 15 tokens                        | 15       |
| **Memory total**                                               | **≤ 380 tokens (~9%)**           | **~200** |
| Recent 3 exchanges verbatim (existing)                         | budgeted separately by the brief | —        |

Rationale: with 400–800 tokens of fixed overhead and ~3,000 left
(`../apple-foundation-models.md`), memory at ≤380 leaves ≥2,600 for the
transcript tail, tool output, and the answer. Hermes' 2,200 + 1,375 chars
(~1,300 tokens) would be a third of the window; Claude Code's 25 KB index
would be the whole window several times over. Measure with
`tokenCount(for:)` rather than the 3–4 chars/token rule wherever iOS 26.4+
is available.

---

## What does not transfer, and why

1. **Mastra observational memory's thresholds and model choice.** Observer
   at 30,000 tokens, Reflector at 40,000, "~30k tokens" average context on
   the benchmark, and "Mastra recommends using a model that has a large
   context window (128K+ tokens)" ([docs](https://mastra.ai/docs/memory/observational-memory), [research](https://mastra.ai/research/observational-memory)).
   The mechanism (background observer replaces history) is Goliath's scribe;
   the numbers are 10× the whole window and the emoji/date/nesting format
   is untested on a 3B reader.
2. **Letta's 2,000-char blocks × several blocks.** One block is ~500–600
   tokens; persona + human + others exceed the memory budget alone
   ([letta#1731](https://github.com/letta-ai/letta/issues/1731)). Keep the
   idea of a visible limit, shrink it to 600 chars total.
3. **Claude Code's index-plus-topic-files.** "first 200 lines ... or the
   first 25KB" of index loaded per session, topic files read on demand by
   the agent ([docs](https://code.claude.com/docs/en/memory)). A 3B model
   deciding which file to read is an extra tool round-trip inside a 4k
   window; the index alone is bigger than the window. Transfer only the
   "one line per memory" discipline and the four `type` categories.
4. **Mem0's two-call JSON update with ids and `old_memory`, plus the async
   summary refresh and graph variant.** Two LLM calls per turn and a
   10×10 comparison task; Mem0's own latency and token numbers assume a
   cloud model ([paper](https://arxiv.org/html/2504.19413)). Goliath keeps
   ADD/UPDATE/DELETE semantics but folds them into one guided call with
   enum-constrained ids (change #5, #7).
5. **Zep's graph engine (BM25 + BFS + entity resolution).** Its value came
   from "1.6k" vs "115k" tokens on cloud-scale histories
   ([paper](https://arxiv.org/html/2501.13956v1)); on a phone the graph is a
   second database and the LLM edge-invalidation prompt is another model
   call. Keep only `observedAt` / `invalidatedAt` / `supersededBy`.
6. **Grok Bot's absolute sizes and per-turn extraction.** 500-char facts,
   100 profile lines, 4,000-char recent budget, and an extraction call
   after every non-trivial turn ([sand-memory.ts](https://github.com/dhanlon-intellica/grok-bot-0.18-reconstructed/blob/a9f633e0/source/host/runner/sand-memory.ts))
   assume a cloud model and a desktop. The grammar, ranking, trivial-exchange
   filter, and frozen render transfer; the cadence and sizes do not.
7. **Hermes' session-start-only injection and its 3,575-char budget.**
   "captured once at session start and never changes mid-session"
   ([docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory))
   is right for a stable prefix but wrong for query-aware facts, which must
   change per turn; and ~1,300 tokens of pinned memory is a third of the
   window.
8. **Chroma's context-rot regime.** Its degradation curves run from 1k to
   1M tokens; at 4k the relevant lesson is distractors and needle-question
   similarity, not length ([Chroma](https://www.trychroma.com/research/context-rot)).
9. **ANN indexes, DiskANN, libsql vector indexes.** Warranted "well past
   100K vectors" ([sqlite-vec release](https://alexgarcia.xyz/blog/2024/sqlite-vec-stable-release/index.html)); a personal assistant never gets there.
10. **EmbeddingGemma as the default embedder.** ~184 MB download and ~200 MB
    RAM ([expo-ai-kit README](https://github.com/saidkaban/expo-ai-kit/blob/main/README.md), [Google blog](https://developers.googleblog.com/en/introducing-embeddinggemma/))
    next to a 3B model that already holds the device's memory budget; it is
    the Android opt-in, not the iOS path.
11. **`SpotlightSearchTool` today.** Swift-only, runs inside `respond`, not
    exposed by any RN provider ([WWDC26 246](https://developer.apple.com/videos/play/wwdc2026/246/), `../rn-providers-and-ai-sdk.md`).
12. **"Invest in larger models rather than better retrieval."** The paper's
    second recommendation ([arXiv 2603.11513](https://arxiv.org/html/2603.11513))
    is not available to Goliath; the first (adaptive retrieval) is the whole
    of change #3.
13. **Fine-tuned small extractors (MemReader-0.6B/4B, DuoMem).** They show
    the ceiling is reachable at this size, but Apple's on-device model is
    not fine-tunable from a third-party app without the adapter entitlement
    (`../apple-foundation-models.md`); prompt narrowing must substitute.

## Sources

- Apple: [WWDC23 10042](https://developer.apple.com/videos/play/wwdc2023/10042/) · [NLContextualEmbedding](https://developer.apple.com/documentation/naturallanguage/nlcontextualembedding) · [WWDC26 241](https://developer.apple.com/videos/play/wwdc2026/241/) · [WWDC26 246](https://developer.apple.com/videos/play/wwdc2026/246/) · [WWDC26 240](https://developer.apple.com/videos/play/wwdc2026/240/) · [WWDC24 10133](https://developer.apple.com/videos/play/wwdc2024/10133/) · [TN3193](https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window) · [Data protection classes](https://support.apple.com/guide/security/data-protection-classes-secb010e978a/web) · [Apple Intelligence & privacy](https://www.apple.com/legal/privacy/data/en/intelligence-engine/) · [ANE transformers](https://machinelearning.apple.com/research/neural-engine-transformers)
- RN providers and stores: [react-native-ai embeddings](https://www.react-native-ai.dev/docs/apple/embeddings) · [Callstack blog](https://www.callstack.com/blog/on-device-ai-introducing-apple-embeddings-in-react-native) · [expo-ai-kit README](https://github.com/saidkaban/expo-ai-kit/blob/main/README.md) · [expo-ai-kit rag.ts](https://github.com/saidkaban/expo-ai-kit/blob/main/src/rag.ts) · [react-native-rag op-sqlite](https://github.com/software-mansion-labs/react-native-rag/blob/main/packages/op-sqlite/README.md) · [react-native-rag executorch](https://github.com/software-mansion-labs/react-native-rag/blob/main/packages/executorch/README.md) · [RN ExecuTorch benchmarks](https://docs.swmansion.com/react-native-executorch/docs/0.5.x/benchmarks/inference-time) · [SWM blog part 3](https://swmansion.com/blog/building-an-ai-powered-note-taking-app-in-react-native-part-3-local-rag-868ba75f818b) · [Expo SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/) · [expo#38693](https://github.com/expo/expo/pull/38693) · [expo#43455](https://github.com/expo/expo/issues/43455) · [op-sqlite install](https://op-engineering.github.io/op-sqlite/docs/installation/) · [Turso vectors](https://docs.turso.tech/features/ai-and-embeddings) · [sqlite-vec release](https://alexgarcia.xyz/blog/2024/sqlite-vec-stable-release/index.html) · [react-native-mmkv](https://github.com/margelo/react-native-mmkv) · [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/) · [Callstack on Hermes](https://www.callstack.com/insights/hermes-javascript-engine)
- Embedding models: [buh/NaturalLanguageEmbeddings](https://github.com/buh/NaturalLanguageEmbeddings) · [model2vec](https://github.com/MinishLab/model2vec) · [model2vec results](https://github.com/MinishLab/model2vec/blob/main/results/README.md) · [potion-base-8M](https://huggingface.co/minishlab/potion-base-8M) · [model2vec.swift](https://github.com/shubham0204/model2vec.swift) · [bge-small-en-v1.5](https://huggingface.co/BAAI/bge-small-en-v1.5) · [EmbeddingGemma](https://developers.googleblog.com/en/introducing-embeddinggemma/) · [sbert pretrained models](https://www.sbert.net/docs/sentence_transformer/pretrained_models.html)
- Memory systems: [MemGPT](https://arxiv.org/html/2310.08560v2) · [Letta memory blocks](https://docs.letta.com/guides/agents/memory-blocks) · [letta#1731](https://github.com/letta-ai/letta/issues/1731) · [Mem0 paper](https://arxiv.org/html/2504.19413) · [Mem0 prompts.py](https://github.com/mem0ai/mem0/blob/main/mem0/configs/prompts.py) · [Zep paper](https://arxiv.org/html/2501.13956v1) · [Mastra working memory](https://mastra.ai/docs/memory/working-memory) · [Mastra memory.ts](https://github.com/mastra-ai/mastra/blob/main/packages/core/src/memory/memory.ts) · [Mastra OM docs](https://mastra.ai/docs/memory/observational-memory) · [Mastra OM research](https://mastra.ai/research/observational-memory) · [Claude Code memory](https://code.claude.com/docs/en/memory) · [Grok Bot sand-memory.ts](https://github.com/dhanlon-intellica/grok-bot-0.18-reconstructed/blob/a9f633e0/source/host/runner/sand-memory.ts) · [Hermes memory docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory) · [Hermes memory_tool.py](https://github.com/NousResearch/hermes-agent/blob/main/tools/memory_tool.py)
- Evidence on small models and selection: [Can Small LMs Use What They Retrieve?](https://arxiv.org/html/2603.11513) · [Chroma context rot](https://www.trychroma.com/research/context-rot) · [Lost in the Middle](https://arxiv.org/html/2307.03172) · [Positional biases shift](https://arxiv.org/html/2508.07479v1) · [NoLiMa](https://arxiv.org/abs/2502.05167) · [Surface-pattern reliance](https://arxiv.org/html/2603.16197v1) · [RECOMP](https://arxiv.org/abs/2310.04408) · [LexRank](https://arxiv.org/abs/1109.2128) · [Hybrid graph priors](https://arxiv.org/abs/2604.23277) · [LongMemEval](https://arxiv.org/abs/2410.10813) · [PersonaMem](https://arxiv.org/abs/2504.14225) · [HaluMem](https://arxiv.org/abs/2511.03506) · [MemReader](https://arxiv.org/abs/2604.07877) · [DuoMem](https://arxiv.org/abs/2606.29961) · [BEAM/LIGHT](https://arxiv.org/abs/2510.27246)
- Assistants and context: [Google Personal Intelligence](https://blog.google/innovation-and-ai/products/gemini-app/personal-intelligence/) · [Gemini memory](https://blog.memoryplugin.com/how-gemini-memory-works/) · [Wing VC on Apple Intelligence](https://www.wing.vc/content/unpacking-apple-intelligence-apples-vision-for-personalized-ai) · [ivanmagda WWDC26](https://ivanmagda.dev/posts/wwdc26-foundation-models-year-two/) · [artemnovichkov token usage](https://artemnovichkov.com/blog/tracking-token-usage-in-foundation-models)
