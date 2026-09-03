# Prompting and decoding for 1–4B models: what measurably helps tool selection, argument filling, and short planning

Research brief for Goliath (round 2). Target: Apple's ~3B on-device Foundation Model — 4,096-token window, one request in flight, guided generation (constrained decoding), no logprobs, no fine-tuning — driven from React Native through the Vercel AI SDK.

Goliath today: a **conductor** plans one flat JSON step at a time (`{kind: tool|answer|escalate, tool, brief}`) from a prompt of instructions + one-line-per-tool menu + 60-word brief + one line per completed step + the ask. Each **worker** gets a fresh context, a one-line brief, and one tool's Zod schema, and returns the arguments as structured output. An **answer** step writes 2–3 sentences from the step log. A **scribe** keeps a brief with slots Goal/Done/Decisions/Pending/Next.

Every claim below carries its source. Numbers are quoted from the source; where a source is a frontier-model study, the transfer caveat is stated in the last section.

---

## 0. The device budget, in numbers

- Apple's 2024 on-device figures (iPhone 15 Pro): "time-to-first-token latency of about 0.6 millisecond per prompt token" and "a generation rate of 30 tokens per second" — [Apple ML Research, Introducing Apple's On-Device and Server Foundation Models](https://machinelearning.apple.com/research/introducing-apple-foundation-models). The 2025 model cut KV cache memory and time-to-first-token by 37.5% via KV-cache sharing — [Apple Intelligence Foundation Language Models Tech Report 2025](https://arxiv.org/html/2507.13575).
- So a 700-token conductor prompt costs roughly 0.3–0.4 s of prefill, and every 30 output tokens cost about 1 s. A `why` field of 20 tokens is ~0.7 s per step; a second full call is ~1.5–2.5 s.
- "The system model supports up to 4,096 tokens"; "A single token corresponds to three or four characters in languages like English"; "the sum of all tokens in the instructions, all prompts, and all outputs count toward the context window size" — [Apple docs, Generating content and performing tasks](https://developer.apple.com/documentation/foundationmodels/generating-content-and-performing-tasks-with-foundation-models).
- "tokens are not free. Each token in your instructions and prompt adds extra latency. Before the model can start producing response tokens, it first needs to process all the input tokens" — [WWDC25 session 301, Deep dive into the Foundation Models framework](https://developer.apple.com/videos/play/wwdc2025/301/).
- The on-device model scores IFEval (instruct) 85.1 at full precision, 82.3 at 2-bit; MMLU 67.85 vs Qwen-2.5-3B 66.37 and Gemma-3-4B 62.81 — [Tech Report 2025](https://arxiv.org/html/2507.13575). It is a strong instruction-follower for its class, which is the capability every recommendation below leans on.

---

## 1. Few-shot vs zero-shot for tool selection and argument extraction

**Verdict: 1–3 examples are the highest-leverage change available to a 3B model that cannot be fine-tuned; more than that is neutral-to-harmful and costs prefill.**

Evidence, small models first:

- **Small Models, Big Tasks** ([arXiv 2504.19277](https://arxiv.org/html/2504.19277)), five 1.3B–3.8B models on function-call generation, "three examples" in the few-shot condition. Deepseek-coder-1.3B went from zero-shot "JSON parsability 7.34%, task accuracy 1.11%" to few-shot "JSON Parsability 89.38%, Task Accuracy 55.65%"; fine-tuned reached 99.44% / 85.43%. Phi-3-mini scored 0.0000 in both zero- and few-shot because of output-format failures, then 99.62% / 87.27% after fine-tuning. The format gap, not the reasoning gap, is the dominant failure at this scale — which guided generation closes for free on Apple's stack. Also: under prompt injection, few-shot models showed a "13% decline in the task accuracy" vs "just 1-2%" for fine-tuned — few-shot prompts are brittle to adversarial content in the same context.
- **Meta-Tool** ([arXiv 2604.20148](https://arxiv.org/html/2604.20148v1)), Llama-3.2-3B-Instruct across APIBench / Spider 2.0 / WebArena / InterCode: "0-shot + documentation: 25.5% average accuracy"; "5-shot + documentation: 47.0%", i.e. "+21.5 percentage points" from the examples. Documentation alone was worth "+5.0%". The paper's own hypernetwork-generated LoRA weights added "+0.0%" over few-shot prompting — for a 3B model, curated examples were the whole gain.
- **When Does Few-Shot Prompting Help?** ([arXiv 2607.22969](https://arxiv.org/html/2607.22969v1)): Llama 3.1 8B macro-F1 0-shot 0.525 → 1-shot 0.865 → 2-shot 0.866 → 8-shot 0.553 (a "64.7% relative gain" from one example, then a collapse at 8). Llama 3.3 70B went the other way, 0.907 zero-shot → 0.757 at 1-shot. The shot curve "is not monotonic, not universal, and not predictable from model scale alone"; recommendation for the 8B regime: "at minimum one demonstration". Note also that a parser bug "deflated Llama 3.3 70B performance by up to 206%" — measure parse failures separately from decision failures.
- **LangChain few-shot tool-calling** ([langchain.com](https://www.langchain.com/blog/few-shot-prompting-to-improve-tool-calling-performance)), frontier models but the smallest tiers matter: Claude 3 Haiku on Multiverse Math went from "11%" zero-shot to "75%" with 3 examples as messages; Claude 3 Sonnet on query analysis 16% → 52% with 3 semantically-retrieved examples. "Few-shotting with messages usually does better than with strings", and 3 semantically similar examples beat 3 static ones.
- **Apple's guidance**: "giving the model less than five examples" directly in the prompt "can boost your task performance"; "phrase your prompts as a clear command"; "the model will perform best when given a single specific task in detail" — [WWDC25 session 248, Explore prompt design & safety](https://developer.apple.com/videos/play/wwdc2025/248/).

Baselines that show how far a raw 3B model is from good on selection and restraint:

- BFCL, raw (no training): Qwen2.5-3B-Instruct overall 30.50%, irrelevance 52.68%; Llama3.2-3B-Instruct overall 40.50%, irrelevance 37.59% — [R2IF, arXiv 2604.20316](https://arxiv.org/html/2604.20316). SFT alone lifts Llama3.2-3B to 60.19% / 56.41%. Fine-tuned Hammer-1.5B reaches 73.04% overall and 72.18% irrelevance — [Hammer, arXiv 2410.04587](https://arxiv.org/html/2410.04587v2). Prompting cannot reach fine-tuned numbers; the realistic prompting goal is raw → "SFT-like" on a small, fixed tool set.
- A small 3-tool, 12-prompt benchmark with 20 runs each ([MikeVeerman/tool-calling-benchmark](https://github.com/MikeVeerman/tool-calling-benchmark)): Qwen3 1.7B 0.960, Qwen3 0.6B 0.880, Llama 3.2 3B 0.660 with "High action, zero restraint", Llama 3.2 1B 0.430. "Prompts requiring judgment — resisting keyword triggers, respecting negation, noticing redundant information — most sub-4B models fail." Five of the models needed fallback parsers; format compliance moved rankings by up to 0.28. Hobby-scale, but it is the only published number set on the exact failure Goliath's conductor will hit: calling a tool when it should answer.

Argument extraction specifically: the same Small-Models study measured "task accuracy" as correct name + arguments, so the 1.11% → 55.65% jump with 3 examples is mostly argument-filling learned from demonstrations. PA-Tool (next section) reports parameter-identification gains of "up to 4.3%" from renaming alone at 3B.

---

## 2. Schema and description design

**Verdict: order fields so anything the decision depends on is generated first; use enums wherever the value set is finite; keep every description to one sentence; use names the model has seen a million times; never rely on a "do not" — encode restraint as an enum option with its own example.**

### 2.1 Field order under constrained decoding

- Apple: "the properties of your Generable type are generated in the order they are declared in the source code ... This order can be important, if you're expecting the value of a property to be influenced by another property" — [WWDC25 301](https://developer.apple.com/videos/play/wwdc2025/301/); "The model generates Generable properties in the order they're declared" — [Apple docs, guided generation](https://developer.apple.com/documentation/foundationmodels/generating-swift-data-structures-with-guided-generation). Guided generation is grammar-masked decoding, so once `kind` is emitted, nothing generated later can revise it.
- **The Constraint Tax** ([arXiv 2605.26128](https://arxiv.org/html/2605.26128v1)), Qwen2.5-0.5B/1.5B/3B and SmolLM2-1.7B, expanded-interface study over four small models: `answer_only_schema` 26.8% accuracy / 99.0% validity; `rationale_answer_schema` 36.5% / 97.8%; `delayed_constraint` (reason free, then constrain) 40.7% / 100%; `prompt_json` (no grammar) 31.5% / 70.0%. A rationale field before the answer is worth +9.7 pts at this scale; the paper's recommendation: "Let the model solve the task, then project the result into the executable object."
- **Let Me Speak Freely** ([ar5iv 2408.02442](https://ar5iv.labs.arxiv.org/html/2408.02442)) found the failure mode in the wild: "100% of GPT 3.5 Turbo JSON-mode responses placed the answer key before the reason key, resulting in zero-shot direct answering instead of chain-of-thought reasoning."
- Field-order A/B on GPT-4o, LiveBench reasoning ([Dylan Castillo](https://dylancastillo.co/posts/llm-pydantic-order-matters.html)): reasoning-first 46.67% vs answer-first 33.33%, paired t-test p < 0.01.
- **JSONSchemaBench** ([arXiv 2501.10868](https://arxiv.org/html/2501.10868v3)), Llama-3.1-8B-Instruct with a `{reasoning, answer}` schema: GSM8K 80.1% unconstrained → 83.8% (Guidance), Last Letters 50.7% → 54.0%, Shuffle Objects 52.6% → 55.9%; "constrained decoding, regardless of the framework, achieves higher performance than the unconstrained setting."
- Caveat for 3B: **R2IF** ([arXiv 2604.20316](https://arxiv.org/html/2604.20316)) notes that at 3B "while the model makes correct tool calls, its reasoning is shallow and lacks depth, relying on simple rules"; untrained reasoning has near-zero measured effect on the decision (ACE ≈ 0). So a `why` field helps by forcing the relevant facts to be restated before committing (a retrieval effect, see §4), not by "thinking". Keep it short and factual, not deliberative.

### 2.2 Enum vs free text

- Under JSON-mode, classification improved: DDXPlus Gemini-1.5-Flash 41.6% text → 60.3% JSON; Sports Understanding GPT-3.5 67.2% → 80.0% — [Let Me Speak Freely, Table 10](https://ar5iv.labs.arxiv.org/html/2408.02442). Constrained selection from a closed set is the one task where constraints help outright.
- But validity is not correctness: hard schema decoding "increased wrong-valid-schema outputs from 49.5% to 88.9%", and on the calendar tool-call task executable accuracy fell from 91.5% (prompt-only JSON) to 48.0% (hard schema) at identical 100% validity — [Constraint Tax](https://arxiv.org/html/2605.26128v1). An enum guarantees the tool exists; it does not guarantee it is the right tool. Goliath's runtime must still validate arguments semantically (referenced entities present in the brief, dates parseable, etc.).
- Apple exposes exactly this: `anyOf: ["Tomato", "Chicken Noodle", "Clam Chowder"]` for strings, `.range`, `.count`, and regex — [Apple docs](https://developer.apple.com/documentation/foundationmodels/generating-swift-data-structures-with-guided-generation). Tool names should be an `anyOf`, not a free string; `kind` already is.

### 2.3 Description length and whether `@Guide` / `.describe()` helps

- Apple, twice: "Keep the descriptions as short as possible — long descriptions take up additional context size and can introduce latency" and "A guide isn't necessary for basic fields" — [guided generation docs](https://developer.apple.com/documentation/foundationmodels/generating-swift-data-structures-with-guided-generation); "Keep descriptions as short as possible because long descriptions take up context size and can introduce latency" — [tool calling docs](https://developer.apple.com/documentation/foundationmodels/expanding-generation-with-tool-calling). Descriptions are "effectively another way of prompting ... it gives the model a stronger relation for what these descriptions are tied to" — [WWDC25 301](https://developer.apple.com/videos/play/wwdc2025/301/).
- Tool descriptions: "make your tool name short, but still readable as English text. Avoid abbreviations, and don't make your description too long, or explain any of the implementations. Because remember, these strings are put verbatim in your prompt ... consider using a verb in the name, such as findContact. And your description should be about one sentence" — [WWDC25 301](https://developer.apple.com/videos/play/wwdc2025/301/).
- **EasyTool** ([arXiv 2401.06201](https://arxiv.org/abs/2401.06201)) rewrote verbose docs into "unified and concise tool instruction" and cut token use "by 70.43%" on ToolBench and "97.35%" on RestBench while improving success.
- **Learning to Rewrite Tool Descriptions** ([arXiv 2602.20426](https://arxiv.org/html/2602.20426v2)), Qwen3-4B as both rewriter and agent: query-level success 33.5% → 44.6%; the descriptions that won stated _selection scope_ ("when to use this, not that") — coverage 97.2% vs 12% in originals — and parameter constraints (94.2% vs 87.9%). With 150+ candidate tools the rewrite "reduces performance degradation by 29.23%". So the one sentence should say when to pick the tool over its neighbours, not what it does internally.
- **FunctionGemma** (270M): "Expanding the function's description to include semantic keywords helps the model bridge the gap" (e.g. adding "can be used to determine if the weather is hot or cold") — [Google AI docs](https://ai.google.dev/gemma/docs/functiongemma/formatting-and-best-practices). At the very small end, the description carries the synonyms the user might use.

### 2.4 Naming (PA-Tool)

- **PA-Tool** ([arXiv 2510.07248](https://arxiv.org/html/2510.07248)), training-free renaming of tools and parameters to names the model finds familiar (measured by sampling "peakedness"): MetaTool Reliability, Llama3.2-3B 43.6% → 60.6% (+17.0); RoTBench single-turn tool selection Qwen2.5-3B 12.4% → 18.1%; parameter identification "up to 4.3%" (Qwen2.5-3B multi-turn 10.0% → 14.3%); "Schema Misalignment (80.0% reduction)"; renaming both tools and parameters (62.9%) beat tool-only (57.1%) or parameter-only (58.1%). Example rename: `DietTool` → `diet_insights`. Humans also rated the new names higher (+0.69 on understanding).
- **Hammer** ([arXiv 2410.04587](https://arxiv.org/html/2410.04587v2)): when function and parameter names were masked "even though the descriptions contained all necessary information ... the performance of xLAM-1B-fc dropped significantly". Small models lean on names far more than on descriptions. Hammer trains against that; Goliath cannot, so it must pick good names instead.
- Practical rule: `verbNoun` / `verb_noun`, common English words, parameter names that match the words in the user's ask (`date`, `title`, `query`, `recipient`), no prefixes or product jargon.

### 2.5 Negative examples, "do not", and the "no tool" option

- Negation is a known small-model weakness: on six ~7B models, negated-prompt accuracy was 45.4–58.3% vs 92.4–95.5% affirmative (Llama-3.1-8B 50.5% vs 94.1%) — [How Language Models Process Negation, arXiv 2605.03052](https://arxiv.org/html/2605.03052v1). Apple's own tip is that the model "will respond well to an all caps command: 'DO NOT'" ([WWDC25 248](https://developer.apple.com/videos/play/wwdc2025/248/)) — use that sparingly for one safety rule, not as a way to teach selection.
- Restraint is learned from positive examples of restraint, not from prohibitions: Hammer's optimum was "approximately 10% irrelevance-augmented data", and more hurt function-calling accuracy (an "inverse relationship") — [Hammer](https://arxiv.org/html/2410.04587v2). In the 3-tool benchmark, restraint prompts and negation traps were where "most sub-4B models fail" — [tool-calling-benchmark](https://github.com/MikeVeerman/tool-calling-benchmark).
- A "no tool" path must be a first-class option in the enum (Goliath's `answer` / `escalate`), with at least one worked example each, rather than a sentence saying "don't call tools unnecessarily".

---

## 3. Constrained decoding effects on small models

**Verdict: constrained decoding is a net win for small models when the schema is designed to let the model state relevant facts before it commits; it is a net loss when the schema forces the decision first. Apple's guided generation is native and cheap, so the latency tax reported elsewhere does not apply — the "constraint tax" that does apply is the field-order one.**

- **JSONSchemaBench** (Llama-3.1-8B, `{reasoning, answer}` schema): +3.7 on GSM8K, +3.3 Last Letters, +3.3 Shuffle Objects under Guidance vs unconstrained — [arXiv 2501.10868](https://arxiv.org/html/2501.10868v3).
- **.txt's rebuttal** of Let Me Speak Freely ([Say What You Mean](https://blog.dottxt.ai/say-what-you-mean.html)), Llama-3-8B-instruct: GSM8K 0.77 unstructured → 0.78 structured; Last Letter 0.73 → 0.77; Shuffle Object 0.41 → 0.44. Their explanation of the original paper's JSON collapse (LLaMA-3-8B GSM8K text 74.7% vs JSON 48.9%; Last Letter 70.1% vs 28.0%, [Table 9](https://ar5iv.labs.arxiv.org/html/2408.02442)): "uses different prompts for structured generation and unstructured generation", no schema in the prompt, and answer-before-reasoning ordering.
- **Constraint Tax** (sub-3B): prompt-only JSON 19.7% answer accuracy / 61.5% validity vs answer-only hard schema 11.0% / 100.0% across 15,000 generations; calendar tool call 91.5% → 48.0% executable accuracy — [arXiv 2605.26128](https://arxiv.org/html/2605.26128v1). This is the number to fear: a bare `{tool, args}` schema at 3B can halve executable accuracy while reporting 100% validity.
- **The Format Tax** ([arXiv 2604.03616](https://arxiv.org/html/2604.03616v1)), SmolLM3-3B rows: JSON output cost GPQA −4.9 pp, MATH-500 −16.6 pp, ZebraLogic −3.4 pp vs freeform; XML −1.2 / −9.1 / −9.6. A two-turn split (reason freely, then format) recovered on average "+6.8 pp" across models, "42 of 72" comparisons significant; for SmolLM3-3B specifically +2.9 / +0.2 / +0.8 — small. Newer API models "show near-zero or positive deltas"; the tax is a small-model phenomenon.
- **In-Writing** ([arXiv 2601.07525](https://arxiv.org/html/2601.07525v2)), 1.5B–14B models, free reasoning then a trigger token that switches on the grammar: LLaMA3-8B GSM8K 66.2% → 77.9%, Last Letter 41.9% → 70.3%, Shuffled Objects 1% → 39.2%; overhead "5–20 tokens". This is the mechanism a `why`-then-`kind` schema approximates inside a single grammar.
- **Tool suppression** ([arXiv 2606.25605](https://arxiv.org/html/2606.25605)): when native tool calling and a JSON response schema are enabled in the same request, tool invocation rate fell from 100% to 0% on every open-weight model tested, because "the < character is never permitted in any JSON FSM state" — the grammar makes tool-call tokens unreachable. Fix: "two-pass execution", tools in pass 1, schema in pass 2, restoring 100%. Goliath already separates the tool decision (conductor schema) from tool execution (runtime) — keep it that way; never hand the model both Apple `Tool`s and a `@Generable` response type in one call.
- **When Correct Isn't Usable** ([arXiv 2605.02363](https://arxiv.org/html/2605.02363v1)), 7–9B: "NAIVE prompting ... achieves up to 85% task accuracy on GSM8K but 0% output accuracy" (no valid JSON); library-level constrained decoding cost "3.6×" (Llama) to "8.2×" (Qwen) latency and produced "52.4% duplicate outputs" on Gemma. On Apple the constraint is applied in the framework at token-mask time, so the latency multiplier does not transfer; the duplicate-output pathology is worth a check in Goliath's eval.

### 3.1 Output format: JSON vs YAML vs key-value

- Model-specific and not something Goliath chooses. In Let Me Speak Freely's GSM8K table, GPT-3.5 did better in YAML (73.9%) than JSON (49.3%) but LLaMA-3-8B did the reverse (YAML 46.1%, JSON 48.9%) and Gemma-2-9B preferred JSON (84.2%) to YAML (79.5%) — [Table 9](https://ar5iv.labs.arxiv.org/html/2408.02442). For generation, "Plain JSON generation shows the best one-shot and final accuracy" vs TOON — [arXiv 2603.03306](https://arxiv.org/abs/2603.03306). Apple's guided generation emits its own structured format from a `@Generable` schema; the app never sees a syntax choice.

### 3.2 A `reasoning` scratchpad inside the schema at 3B: help or cost?

- Helps: +9.7 pts on small models ([Constraint Tax](https://arxiv.org/html/2605.26128v1)), +3 on 8B ([JSONSchemaBench](https://arxiv.org/html/2501.10868v3)), +13 pts on GPT-4o ([Castillo](https://dylancastillo.co/posts/llm-pydantic-order-matters.html)). The delayed-constraint variant (40.7%) beat the in-schema rationale (36.5%) by 4 pts, but costs a second call.
- Costs: at 30 tok/s a 20-token `why` is ~0.7 s per conductor step; a 60-token deliberation is 2 s. The R2IF finding that 3B reasoning is "shallow" says the marginal value of long reasoning is low — a short, fact-restating field captures most of the gain.
- Recommendation: a bounded `why` ("one short sentence naming the fact that decides this step"), first in the schema, A/B tested against no-`why` on the same prompt set, measuring tool-selection accuracy, restraint rate, and wall-clock per step.

---

## 4. Prompt length vs quality; instruction placement; recency

**Verdict: every token costs both latency and accuracy at this scale; hold instructions to one task, put stable rules in Apple's `instructions` slot (obeyed over prompts), keep the tool menu ordered with the most likely tools last, and end the prompt with the ask.**

- Apple: "When a prompt is long and complicated, the model takes longer to respond, and may respond in unpredictable ways"; "If you have a complex generation task in mind, break the task down into a series of specific prompts"; "Use phrases like 'in a single sentence' or 'in a few words' to shorten the generation time" — [Apple docs](https://developer.apple.com/documentation/foundationmodels/generating-content-and-performing-tasks-with-foundation-models). "The model obeys prompts at a lower priority than the instructions you provide"; "Use content you trust in instructions because the model follows them more closely than the prompt itself"; and instructions should carry the role, the task, style ("Respond as briefly as possible"), and safety. "Our model is trained to obey instructions over prompts" — [WWDC25 248](https://developer.apple.com/videos/play/wwdc2025/248/).
- The "1–3 paragraphs" figure: no Apple guidance with that wording was found. The phrase appears only as an example prompt ("Summarize this article in 1-3 paragraphs") in third-party write-ups (e.g. [destiner.io](https://destiner.io/blog/post/foundation-models-basic-prompting-ios-reader-app)). What Apple does say is "a single specific task", "less than five examples", "about one sentence" per tool description, and "as short as possible" per property description.
- **Context Length Alone Hurts** ([arXiv 2510.05381](https://arxiv.org/html/2510.05381), EMNLP 2025 Findings): with retrieval held at 100%, Llama-3.1-8B "Drops 24.2% on MMLU, 59% on Variable Summation at 30K tokens"; even whitespace padding costs "at least 7%", fully masked padding "at least 7.9%". Mitigation, "retrieve then solve" — "recite the evidence retrieved from the long context and prepend it directly before the question" — gave "up to 31.2% improvement" for Mistral. Goliath's scribe brief _is_ this recitation; the `why` field is a second, per-step recitation.
- **Prompt Design at Scale** ([arXiv 2607.19257](https://arxiv.org/html/2607.19257)): perfect-instruction-following "collapses to zero by N=80" instructions for every model (Claude Haiku 85% at N=10 → 0% at N=80); format (markdown / JSON / XML / plain) moved adherence by under ~2 pp; system-vs-user placement "produces effects at least as large as format" but the sign was model-specific (Haiku +6.6 pp for user turn, Gemini Flash −8.7 pp). Keep the rule count in the teens, and A/B the placement on the actual device model.
- **Car Wash follow-up** ([arXiv 2603.13351](https://arxiv.org/html/2603.13351)): the same reason-then-conclude scaffold scored 100% as "a 10-line prompt" and "0–30%" inside "a 60+ line system prompt", because a competing instruction ("Lead with specifics") forced the conclusion first. Frontier model, but the mechanism — a later instruction reversing the reason-then-decide order — is exactly what an accumulating Goliath conductor prompt could do.
- **LongFuncEval** ([arXiv 2505.10570](https://arxiv.org/html/2505.10570)): growing the tool catalog from 8K to 120K tokens cost "7.59% to 85.58%"; models "performing better when answers appeared later in contexts" (recency), with position alone moving accuracy "5% (GPT-4o) to 75% (Mistral-large)".
- Small models are recency-biased: LLaMA-2-7B on NaturalQuestions by gold-document position — position 1: 32.4%, position 5: 23.8%, position 10: 30.6%, position 15: 31.6%, position 20: 38.2% — [arXiv 2406.02536](https://arxiv.org/html/2406.02536v2). Last beats first by ~6 pts, middle is worst.
- Anthropic's Claude guidance: "Put longform data at the top ... above your query, instructions, and examples"; "Queries at the end can improve response quality by up to 30 percent in tests" — [Claude prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices). Frontier-model number; the direction matches the small-model recency data above.
- Small-model prompt injection: the Small-Models study's few-shot models lost "13%" task accuracy under injection — [arXiv 2504.19277](https://arxiv.org/html/2504.19277). Apple: "make sure the instructions only come from you and never include untrusted content or user input" — [WWDC25 248](https://developer.apple.com/videos/play/wwdc2025/248/). Tool results and the user's ask belong in the prompt, never in `instructions`.

---

## 5. Sampling, self-consistency, verification — what is affordable on device

**Verdict: greedy for every structured call; no routine second sample and no same-model "verify" pass; the only sampling trick that pays for itself is retry-on-validation-failure with a small temperature.**

- Apple: "the default behavior is random sampling"; "You can set it to greedy to get deterministic output ... the same output for the same prompt, assuming your session is also in the same state" (until an OS update changes the model); temperature 0.5 for output "that only varies a little" — [WWDC25 301](https://developer.apple.com/videos/play/wwdc2025/301/). `maximumResponseTokens` warning: "Enforcing a strict token response limit can lead to the model producing malformed results" — [GenerationOptions docs](https://developer.apple.com/documentation/foundationmodels/generationoptions). Bound length by schema and wording, not by the token cap.
- Temperature 0.0–1.0 made no statistically significant difference on MCQ problem solving (GPT-3.5, five prompt styles, all p > 0.4); accuracy hit chance "by 1.4" — [arXiv 2402.05201](https://arxiv.org/html/2402.05201v1). Greedy loses nothing in expected accuracy and buys reproducible evals.
- Best-of-N works for small tool callers only with a separate reward model and large N: Qwen3-0.6B 39.5% greedy → 64.4% at best-of-32 with ToolRM-14B; Qwen3-1.7B BFCL 55.74% → 61.05%; majority voting over the same 32 samples reached only 57.96% and schema-validation selection 56.34% — [ToolRM, arXiv 2509.11963](https://arxiv.org/html/2509.11963). With one request in flight at ~2 s per call, N=32 is a minute per step and the selector model does not exist on device. Majority vote at N=2 is undefined (no majority), at N=3 costs 3× for a fraction of the +2.2 pts the 32-sample vote gave.
- Ranked-voting self-consistency added 3.32% (Llama-3.2-3B) and 4.95% (Qwen-2.5-3B) over plain self-consistency, again over many samples — [arXiv 2505.10772](https://arxiv.org/html/2505.10772v1).
- Same-model verification does not help small models: intrinsic self-correction took GPT-4 on GSM8K from 95.5% → 91.5% → 89.0% over two rounds, and "Llama-2 frequently converts correct answers into incorrect ones" — [Large Language Models Cannot Self-Correct Reasoning Yet, arXiv 2310.01798](https://arxiv.org/abs/2310.01798). For ≤13B models, "a weak self-verifier yields only minor improvements, or can even misguide the refiner"; the +14.6% gain required a GPT-4 verifier — [arXiv 2404.17140](https://arxiv.org/abs/2404.17140).
- What is cheap and does help: deterministic checks after the call (tool ∈ menu, Zod refinements pass, every proper noun / number in the arguments appears in the brief or the ask, required fields non-empty), then one retry at temperature ≈ 0.5 with the failure named in the prompt, then `escalate`. The Constraint Tax's "wrong-valid" numbers (88.9% of errors are valid objects) say the validator, not a second sample, is where the accuracy is.
- Latency arithmetic at 0.6 ms/prompt token + 30 tok/s: conductor (≈700 in, ≈40 out) ≈ 0.4 s + 1.3 s ≈ 1.7 s; worker (≈300 in, ≈30 out) ≈ 0.2 s + 1.0 s ≈ 1.2 s; a verify pass on the plan step adds another ≈1.5 s for negative expected value. A `why` of 15–20 tokens adds ≈0.6 s with positive expected value.

---

## 6. Compressing tool results for a small reader

**Verdict: fewer tokens beats any format; among formats, `key: value` lines win for small readers on lookup, and JSON/CSV/pipe formats lose. Token-optimized notations (TOON/TRON) are risky for tool-call reasoning.**

- 11-format comparison on **GPT-4.1-nano** (1,000 records, 1,000 lookup queries) — [improvingagents.com](https://www.improvingagents.com/blog/best-input-data-format-for-llms): Markdown-KV 60.7% (52,104 tokens); XML 56.0%; INI 55.7%; YAML 54.7%; HTML 53.6%; JSON 52.3% (66,396 tokens); Markdown-Table 51.9% (25,140 tokens); Natural-Language 49.6%; JSONL 45.0%; CSV 44.3% (19,524 tokens); Pipe-Delimited 41.1%. Key: value lines beat JSON by 8.4 pts with 21% fewer tokens; the compact table formats bought tokens with accuracy.
- **TOON benchmarks** on the smallest tier, GPT-5.4 Nano, 244 retrieval questions — [toonformat.dev](https://toonformat.dev/guide/benchmarks): XML 59.4%, JSON 57.4%, TOON 57.0%, JSON compact 54.9%, YAML 54.5%, CSV 46.8% (109 flat questions). Differences among structured formats are within the ±6 pt CI; CSV is reliably worst. Across all models TOON 72.2% vs JSON 71.4% with "42.6% fewer tokens".
- **Notation Matters** ([arXiv 2605.29676](https://arxiv.org/html/2605.29676)), 17B–32B models on tool-calling tasks: TOON dropped Mistral-Small-24B on BFCL "from 89% under JSON to 53%"; parallel tool-call accuracy "collapses to near zero" under full compression. Do not feed the conductor exotic notations.
- **Table Meets LLM** ([arXiv 2305.13062](https://arxiv.org/html/2305.13062v4)), GPT-3.5: markup (HTML) beat NL+separator by "6.76%" overall, but on the fine-grained tasks markdown / JSON / XML / HTML were within ~3 pts of each other (cell lookup 42.67–44.00%). Format explanations "may undermine Search and Retrieval" — do not spend tokens explaining the format to the model.
- Length dominates format: tool-response QA already ranged "16% to 74%" at 10K tokens and fell a further 7–91% by 80K — [LongFuncEval](https://arxiv.org/html/2505.10570); recitation of only the relevant facts before the question recovered up to 31.2% — [arXiv 2510.05381](https://arxiv.org/html/2510.05381).
- Practical shape for Goliath: the scribe (or the tool adapter) turns a result into ≤ 8 `key: value` lines with the fields the next decision could need, drops everything else, and writes the one-line step-log entry from those lines. Goliath's Goal/Done/Decisions/Pending/Next brief is already the Markdown-KV shape that scored best.

---

## What Goliath should change

Each item is concrete and testable on a fixed eval set (≥ 60 asks across the tool set, ≥ 10 of them "answer directly", ≥ 5 "escalate", greedy decoding, 3 runs), scoring tool-selection accuracy, argument exact-match after normalisation, restraint rate (no tool when none is needed), and median wall-clock per step.

1. **Add a bounded `why` field first in the plan schema, before `kind`.** Expected +5–10 pts on selection at 3B for ~0.6 s/step. Test: `why` vs no-`why`, same prompts. Sources: [Constraint Tax](https://arxiv.org/html/2605.26128v1) (26.8% → 36.5%), [JSONSchemaBench](https://arxiv.org/html/2501.10868v3) (+3), [Castillo](https://dylancastillo.co/posts/llm-pydantic-order-matters.html) (+13), Apple property-order rule ([WWDC25 301](https://developer.apple.com/videos/play/wwdc2025/301/)). Bound it in the description ("one short sentence naming the fact that decides this step"), not with `maximumResponseTokens` ([GenerationOptions](https://developer.apple.com/documentation/foundationmodels/generationoptions)).
2. **Make `tool` an enum of the menu plus `"none"`, and keep `kind` an enum.** Enums are the case where constraints help outright ([Let Me Speak Freely, Table 10](https://ar5iv.labs.arxiv.org/html/2408.02442)); Apple supports `anyOf` for strings ([docs](https://developer.apple.com/documentation/foundationmodels/generating-swift-data-structures-with-guided-generation)). Test: hallucinated-tool-name rate before/after (PA-Tool reports "80.0% reduction" in schema misalignment from names alone; an enum takes it to zero).
3. **Put 2–3 worked plan-step examples in the conductor `instructions`: one `tool`, one `answer`, one `escalate`.** Keep under Apple's "less than five" ([WWDC25 248](https://developer.apple.com/videos/play/wwdc2025/248/)); ~25 tokens each. Expected: the largest single gain available ([Meta-Tool](https://arxiv.org/html/2604.20148v1) +21.5 pp at 3B; [Small Models, Big Tasks](https://arxiv.org/html/2504.19277) 1.11% → 55.65%; [2607.22969](https://arxiv.org/html/2607.22969v1) 0.525 → 0.865 at one shot). Test: 0 vs 1 vs 3 examples; watch for the 8-shot collapse and stop at 3. If the Vercel AI SDK provider maps prior messages to Apple `Transcript` entries, also test examples-as-turns vs examples-as-text ([LangChain](https://www.langchain.com/blog/few-shot-prompting-to-improve-tool-calling-performance): messages beat strings).
4. **Give one of those examples to restraint, and delete every "do not" about tool use.** ~7B models score ~50% on negated instructions vs ~94% affirmative ([arXiv 2605.03052](https://arxiv.org/html/2605.03052v1)); restraint at 3B is where hobby benchmarks show 0.000 ([tool-calling-benchmark](https://github.com/MikeVeerman/tool-calling-benchmark)); Hammer's irrelevance data sweet spot was ~10% ([Hammer](https://arxiv.org/html/2410.04587v2)). Keep at most one all-caps `DO NOT` for the safety line ([WWDC25 248](https://developer.apple.com/videos/play/wwdc2025/248/)). Test: restraint rate and false-tool-call rate on the "answer directly" asks.
5. **Move the ask to the very end of the conductor prompt, after the brief and step log; put stable rules in `instructions`.** Apple: instructions are obeyed over prompts ([docs](https://developer.apple.com/documentation/foundationmodels/generating-content-and-performing-tasks-with-foundation-models)); small models are recency-biased ([2406.02536](https://arxiv.org/html/2406.02536v2): last position 38.2% vs first 32.4% at 7B; [LongFuncEval](https://arxiv.org/html/2505.10570)); Claude guidance quotes up to 30% from query-at-end ([Anthropic](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)). Test: ask-last vs ask-first on the same set. Also A/B whether the tool menu lives in `instructions` or the prompt — [2607.19257](https://arxiv.org/html/2607.19257) found placement effects of ±6–9 pp with a model-specific sign.
6. **Order the tool menu so the most likely candidates are listed last** (or re-order per step by a cheap keyword overlap with the ask). Recency effect on selection: [LongFuncEval](https://arxiv.org/html/2505.10570) position variation "5% to 75%". Test: fixed order vs relevance-sorted-last.
7. **Rename tools and parameters to model-familiar English (`findContact`, `createEvent`, `query`, `date`, `title`), one sentence per tool stating when to pick it over its neighbours.** [PA-Tool](https://arxiv.org/html/2510.07248): +17.0 pp reliability at 3B from names; [2602.20426](https://arxiv.org/html/2602.20426v2): selection-scope sentences were the property that mattered (97.2% vs 12%); [WWDC25 301](https://developer.apple.com/videos/play/wwdc2025/301/): verb names, one sentence. PA-Tool's peakedness renaming can be run **offline at tool-definition time** by sampling the on-device model repeatedly and keeping the name it converges on — no logprobs needed. Test: hallucinated-name rate and selection accuracy per rename.
8. **Cap the conductor prompt at ~600 tokens and the worker at ~300, measured, and count rules (aim < 20 lines of instructions).** Accuracy falls with length even when nothing relevant is added ([2510.05381](https://arxiv.org/html/2510.05381): ≥7% at 30K of whitespace; [2607.19257](https://arxiv.org/html/2607.19257): compliance collapses by N=80 rules); Apple: long prompts "may respond in unpredictable ways" ([docs](https://developer.apple.com/documentation/foundationmodels/generating-content-and-performing-tasks-with-foundation-models)). Test: accuracy and TTFT vs prompt length buckets.
9. **Worker: keep `.describe()` to one clause, omit it on self-evident fields, use enums/ranges/regex for finite values, and add a trailing optional `missing` string.** Apple: "A guide isn't necessary for basic fields"; descriptions "as short as possible" ([docs](https://developer.apple.com/documentation/foundationmodels/generating-swift-data-structures-with-guided-generation)). `missing` (last, so it cannot steal the argument budget) lets the worker say which required value the brief did not contain instead of inventing one — the Constraint Tax's 88.9% "wrong-valid" outputs are exactly invented values. Test: argument hallucination rate (values not traceable to brief/ask) with and without `missing`.
10. **Run everything greedy; retry once at temperature 0.5 only when a deterministic validator fails; never add a same-model "verify" call.** Temperature 0–1 is accuracy-neutral ([2402.05201](https://arxiv.org/html/2402.05201v1)); majority vote needs N≥3 and gave +2.2 pts at N=32 ([ToolRM](https://arxiv.org/html/2509.11963)); self-correction without an external verifier is negative at small scale ([2310.01798](https://arxiv.org/abs/2310.01798), [2404.17140](https://arxiv.org/abs/2404.17140)). Test: validator-triggered retry rate, and accuracy delta of retry vs escalate-on-first-failure.
11. **Validate semantically, not just structurally, before executing a tool.** Tool ∈ menu; Zod refinements; every literal in the arguments (names, numbers, dates) appears in the brief or the ask; required fields non-empty. Justification: hard schemas moved executable accuracy 91.5% → 48.0% at 100% validity ([Constraint Tax](https://arxiv.org/html/2605.26128v1)). Test: executable-accuracy vs schema-validity gap.
12. **Compress tool results to ≤ 8 `key: value` lines before they reach the scribe or conductor; never pass raw JSON, CSV, or TOON.** Markdown-KV 60.7% vs JSON 52.3% vs CSV 44.3% on a nano model ([improvingagents.com](https://www.improvingagents.com/blog/best-input-data-format-for-llms)); TOON cost a 24B model 36 pts on BFCL ([Notation Matters](https://arxiv.org/html/2605.29676)); recitation of only relevant facts recovered up to 31.2% ([2510.05381](https://arxiv.org/html/2510.05381)). Test: answer accuracy and step count with raw vs compressed results.
13. **Keep native tool calling and guided generation in separate calls (already true — make it a lint).** Joint tools + schema drove tool invocation to 0% on every open-weight model tested ([2606.25605](https://arxiv.org/html/2606.25605)).
14. **Instrument parse/validity failures separately from decision failures in the eval.** A parser bug deflated one model's score "by up to 206%" ([2607.22969](https://arxiv.org/html/2607.22969v1)); five of the small models in the 3-tool benchmark changed rank on parser fixes ([tool-calling-benchmark](https://github.com/MikeVeerman/tool-calling-benchmark)).
15. **Tool results and the user's ask never enter `instructions`.** Few-shot small models lost 13% under injection ([2504.19277](https://arxiv.org/html/2504.19277)); Apple: instructions must "never include untrusted content or user input" ([WWDC25 248](https://developer.apple.com/videos/play/wwdc2025/248/)).

### Proposed conductor `instructions` (stable; ~230 tokens)

```
You plan one step at a time for a personal assistant. Read the brief, the steps done so far, and the ask. Then choose exactly one next step.

Tools (pick one only when its result is needed to finish the ask):
- findContact — look up a person's phone or email by name.
- createEvent — add a calendar event with a title and a date or time.
- sendMessage — send a text to a contact already found.
- searchNotes — find the user's notes about a topic.

Kinds:
- tool: a tool result is needed next. Name the tool and, in brief, say what it should do in one sentence with the exact names, dates, and words to use.
- answer: the brief and steps already hold what the ask needs, or the ask is a question you can answer from them.
- escalate: the ask needs something no tool provides, or a step failed twice.

Examples
Ask: "Text Priya that I'm running 10 minutes late." Steps: (none)
→ why: Priya's number is not in the brief yet. kind: tool. tool: findContact. brief: Find the phone number for Priya.
Ask: "What did I decide about the venue?" Brief Decisions: venue is Rosa's on 5th.
→ why: The decision is already in the brief. kind: answer. tool: none. brief: Say the venue is Rosa's on 5th.
Ask: "Book a table at Rosa's for Friday." Steps: (none)
→ why: No tool can book a restaurant. kind: escalate. tool: none. brief: Restaurant booking is not available; offer to add a reminder instead.

Answer in the schema. DO NOT invent names, numbers, or dates that are not in the brief, the steps, or the ask.
```

Adjust the menu to the real tool set; keep one sentence per tool stating when to pick it, verbs in names. The three examples are the "less than five" budget; do not add a fourth without an A/B.

### Proposed conductor prompt body (per step; ask last)

```
Brief
Goal: <one line>
Done: <one line>
Decisions: <one line>
Pending: <one line>
Next: <one line>

Steps so far
1. findContact → Priya: +1 415 555 0134
2. <one line per step, key: value results only>

Ask: <the user's ask, verbatim>
Choose the next step.
```

### Proposed plan schema (order matters)

```ts
const PlanStep = z.object({
  why: z.string().describe("One short sentence naming the fact that decides this step."),
  kind: z.enum(["tool", "answer", "escalate"]),
  tool: z.enum([...toolNames, "none"]),
  brief: z
    .string()
    .describe(
      "One sentence for the worker: what to do, with the exact names, dates, and words to use.",
    ),
});
```

`why` first (item 1), enums for `kind` and `tool` (item 2), `brief` last so it can quote from `why`. If the A/B shows `why` is not paying for its ~0.6 s at your tool set size, drop it and keep the rest.

### Proposed worker `instructions` (~90 tokens) and schema shape

```
You fill in the arguments for one tool call. Use only the names, numbers, dates, and words in the brief. Copy them exactly. If a required value is not in the brief, leave it empty and name it in `missing`.
```

Prompt body: `Tool: createEvent — add a calendar event with a title and a date or time.` then `Brief: <one sentence from the conductor>` last. Schema: the tool's Zod object with one-clause `.describe()` only where the field name is not self-explanatory, `z.enum` / ranges / regex wherever the value set is finite, and a trailing `missing: z.string().optional().describe("Required values the brief did not contain.")`.

### Proposed answer step

Keep 2–3 sentences but say so by wording, not by token cap ("in two or three sentences" — Apple's own length lever, [WWDC25 248](https://developer.apple.com/videos/play/wwdc2025/248/)), and feed it the compressed step log only (item 12), with the ask last.

---

## What does not transfer, and why

- **Best-of-N with a reward model** ([ToolRM](https://arxiv.org/html/2509.11963)) — needs N=32 samples and a 14B selector; the device runs one request at a time at ~2 s per call and has no second model. Majority vote at affordable N is either undefined (N=2) or 3× latency for a fraction of +2.2 pts.
- **Confidence-weighted self-consistency and peakedness-at-runtime** — need logprobs or many samples per call; Apple exposes neither. PA-Tool's renaming survives only as an offline, dev-time procedure.
- **In-Writing / delayed-constraint decoding** ([2601.07525](https://arxiv.org/html/2601.07525v2), [2605.26128](https://arxiv.org/html/2605.26128v1)) — requires switching the grammar on mid-generation at a trigger token; Apple applies one schema per request. The single-schema `why`-first field is the closest approximation (36.5% vs 40.7% in the Constraint Tax study); the two-call version costs a full extra call for ~4 pts.
- **Fine-tuning results** (Hammer, xLAM, R2IF, Small-Models fine-tuned rows, FunctionGemma) — the on-device model cannot be trained by Goliath. They set the ceiling (Hammer-1.5B 73% BFCL) and show what prompting must substitute for (irrelevance data, name-masking), not a recipe.
- **Let Me Speak Freely's "JSON hurts" numbers** — shown by [.txt](https://blog.dottxt.ai/say-what-you-mean.html) to come from mismatched prompts and answer-before-reasoning order; and its JSON-mode is a post-hoc API mode, not Apple's grammar-masked guided generation.
- **Library constrained-decoding latency multipliers** (3.6×–8.2× in [2605.02363](https://arxiv.org/html/2605.02363v1)) — Apple's masking runs inside the framework's decode loop; the cost to measure on device is the field's token count, not the constraint.
- **JSON vs YAML vs key-value as an _output_ format** — the app never chooses the emitted syntax under guided generation; the finding only applies to what the model _reads_ (§6).
- **Long-context degradation curves at 30K–128K tokens** — Goliath never exceeds 4,096; only the direction (shorter is better, even with padding) and the recitation fix transfer.
- **Frontier-model placement numbers** (Anthropic's "up to 30 percent", the Car Wash 100% → 0–30%, the ±6–9 pp system-vs-user sign) — measured on Claude / Gemini; the on-device model's sign must be measured, which is why items 5 and 6 are framed as A/Bs.
- **Few-shot-as-messages** ([LangChain](https://www.langchain.com/blog/few-shot-prompting-to-improve-tool-calling-performance)) — depends on whether the Vercel AI SDK provider maps prior messages to Apple `Transcript` entries; if it flattens them to text, the examples-as-text result is the only one that applies.
- **Google's "few-shot tool-use doesn't work"** ([research.google](https://research.google/blog/few-shot-tool-use-doesnt-really-work-yet/)) — 2023-era models, and it asked whether tools beat no-tools on QA benchmarks, not whether examples improve tool selection; superseded by the 2025–2026 small-model results above.
- **TOON's headline** ("72.2% vs 71.4% with 42.6% fewer tokens") — measured on retrieval over large uniform arrays; Goliath's inputs are ≤ 8-line briefs where the token saving is nil and the tool-call-task risk ([Notation Matters](https://arxiv.org/html/2605.29676)) is real.
