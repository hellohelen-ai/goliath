# On-device function-calling agents and planners for small models — prior art for Goliath

Research date: 2026-09-03. Scope: TinyAgent, LLMCompiler, Octopus v2/v3/v4 + Octo-planner, Apple's own Foundation Models guidance (WWDC25/26, TN3193, tech report, utilities package), and 2025–26 papers on planning with 1–4B models. Every claim carries the URL it came from. Where a number comes from a secondary source rather than the paper, it says so.

Goliath's shape, for reference: conductor plans one flat JSON step at a time (`{kind: tool|answer|escalate, tool, brief}`); each worker gets a fresh context and one tool and returns only the arguments as structured output; Goliath runs the tool; results compress to `key: value` lines; writes confirm first; repeated call / empty answer (after one nudge) / malformed plan (after one hinted retry) / model error escalate to a cloud fallback with the step log; a scribe keeps a 60-word brief with slots Goal/Done/Decisions/Pending/Next; three dead turns flip the session to the cloud.

---

## 1. Each system in five lines

### TinyAgent (UC Berkeley, Erdogan et al., EMNLP 2024 Demo)

- A Siri-like Mac assistant driven by a 1.1B or 7B model that emits an LLMCompiler-style plan — a numbered list of function calls with `$N` back-references ending in `join()` — in one generation, then executes it as a DAG. https://arxiv.org/abs/2409.00608
- 16 Mac tools (Mail compose/reply/forward, Contacts phone/email lookup, SMS, Calendar, Maps, Notes create/open/append, read file, summarize PDF, Reminders, Zoom) plus sub-agents for PDF summarization, email writing, note-taking. https://github.com/SqueezeAILab/TinyAgent
- Base models (TinyLlama-1.1B-32K-Instruct, WizardLM-2-7B) scored 12.71% / 41.25% before fine-tuning; after LoRA on 80k GPT-4-Turbo-generated plans they hit 78.89% / 83.09%, and with ToolRAG 80.06% / 84.95% vs GPT-4-Turbo 79.08% and GPT-3.5 65.04%. https://arxiv.org/html/2409.00608v3
- ToolRAG: a fine-tuned DeBERTa-v3-small does 16-way multi-label classification over the query, keeps tools with sigmoid prob > 0.5 (avg 3.97 tools), then retrieves top-k in-context examples by cosine similarity over `text-embedding-3-small` restricted to those tools; prompt drops from 2,762 to 1,397 tokens with tool recall 0.998. https://arxiv.org/html/2409.00608v3 , https://github.com/SqueezeAILab/TinyAgent/blob/main/src/tiny_agent/tool_rag/classifier_tool_rag.py
- End-to-end planner latency on a MacBook Pro M3: 1.1B 4-bit 2.9 s (0.68 GB), 7B 4-bit 13.1 s (4.37 GB); GPT-4-Turbo 3.9 s. https://arxiv.org/html/2409.00608v3

### LLMCompiler (Kim et al., ICML 2024)

- Three parts: a Function Calling Planner that emits a whole DAG of calls, a Task Fetching Unit that resolves `$id` placeholders and dispatches ready tasks, and an Executor that runs them in parallel. https://arxiv.org/abs/2312.04511
- The plan ends in `join()`; a second "joiner" LLM call then outputs either `Finish` or `Replan`; on Replan the planner is re-prompted with the "Previous Plan" and its results and told to "NEVER repeat the actions that are already executed". https://github.com/SqueezeAILab/LLMCompiler/blob/main/src/llm_compiler/planner.py , https://github.com/SqueezeAILab/LLMCompiler/blob/main/src/llm_compiler/constants.py
- Vs ReAct: up to 3.7x latency speedup, up to 6.7x cost saving, up to ~9% accuracy gain. https://arxiv.org/abs/2312.04511
- Motivating ReAct failures: ~10% of HotpotQA examples needed >4 calls under ReAct "usually resulting in infinite loop or divergent behavior"; ~85% of Movie Recommendation examples stopped early before completing all searches. https://arxiv.org/html/2312.04511
- Plans are streamed token-by-token to the fetcher (regex-parsed), worth up to 1.3x extra when tools are slow. https://arxiv.org/html/2312.04511

### Octopus v2 / v3 / v4 and Octo-planner (Nexa AI, 2024)

- v2: a Gemma-2B fine-tune where each function becomes a new tokenizer token `<nexa_0>..<nexa_N-1>`; output is `<nexa_i>(args)<nexa_end>`, so function descriptions never appear in the prompt (95% context reduction). https://arxiv.org/html/2404.01744v6
- v2 numbers: 99.524% accuracy at 0.38 s per call vs GPT-4 98.571% / 1.02 s, GPT-3.5 97.143% / 1.18 s, Llama-7B+RAG 68.095% / 13.46 s; 35x faster than Llama-7B+RAG; 1.1–1.7 s per query on-device per the model card. https://arxiv.org/html/2404.01744v6 , https://huggingface.co/NexaAI/Octopus-v2
- v2 recipe: 20 Android APIs, 1,000 positive + 1,000 negative Gemini-generated samples per API, full fine-tune (AdamW 5e-5, 3 epochs) or LoRA r16/α32; parallel and nested calls need ~4K samples per API to match single-call accuracy; function set is assumed fixed. https://arxiv.org/html/2404.01744v6
- v3 is a sub-1B multimodal variant running "on devices as constrained as a Raspberry Pi"; v4 uses functional tokens to route among specialist open models (MMLU 74.8 under 10B). https://arxiv.org/abs/2404.11459 , https://arxiv.org/abs/2404.19296
- Octo-planner splits planner (Phi-3 Mini 3.8B, fine-tuned on GPT-4-generated plans, multi-LoRA per domain) from action model (Octopus); 97% in-domain plan success. https://arxiv.org/abs/2406.18082

### Apple Foundation Models (WWDC25/26, TN3193, tech report, utilities)

- The on-device model is ~3B parameters with KV-cache sharing and 2-bit QAT; the framework offers "guided generation, constrained tool calling, and LoRA adapter fine-tuning" and "guarantee[s] the structural correctness of tool calls by preventing hallucinated tool names or arguments". https://arxiv.org/html/2507.13575v1
- Context is 4,096 tokens per session on iOS 26 ("always 4096" per DTS); everything counts — instructions, prompts, tool schemas/inputs/outputs, Generable schemas, responses. iOS 26.4 added `contextSize` and `tokenCount(for:)`; on the current-generation model `contextSize` reports 8,192 (secondary source). https://developer.apple.com/forums/thread/806542 , https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window , https://peterfriese.dev/blog/2026/hybrid-ai-apple-foundation-models-gemini
- TN3193's prescriptions: split a task into smaller steps each in a new session and assemble; keep prompts to 1–3 paragraphs; give the model "a maximum of 3–5 tools"; run a tool directly before calling the model when the model should always have its output; break tool calls across sessions. https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window
- WWDC26 added Dynamic Profiles (swap instructions/tools/model inside one session), `historyTransform`, `onResponse` summarization, and two named orchestration patterns: baton-pass (profiles share the transcript, a tool flips the active profile) and phone-a-friend (a tool spawns an isolated child session and the parent always answers). https://developer.apple.com/videos/play/wwdc2026/242/ , https://developer.apple.com/videos/play/wwdc2026/241/
- Apple's open-source `foundation-models-utilities` ships composable history modifiers (drop completed tool calls → rolling window → summarize when 10 entries exceed 5,000 tokens) and a Skills API that loads procedural context just-in-time via a tool call. https://github.com/apple/foundation-models-utilities

### NVIDIA "Small Language Models are the Future of Agentic AI" (Belcak et al., 2025)

- Three claims: SLMs are sufficiently powerful (V1), operationally more suitable (V2), and more economical (V3) for most agentic invocations. https://arxiv.org/html/2506.02153
- Supporting arguments include A4 "agent interfaces expose only narrow subsets of LM capabilities" and A5 "agent systems require strict behavioral alignment with code (formatting consistency)". https://arxiv.org/html/2506.02153
- Recommended architecture: heterogeneous, "SLMs by default and LLMs invoked selectively and sparingly". https://arxiv.org/html/2506.02153
- LLM→SLM conversion algorithm S1–S6: log non-HCI calls, scrub, cluster prompts/actions into recurring task types, pick SLMs, LoRA/QLoRA fine-tune per task, loop. https://arxiv.org/html/2506.02153
- Case studies: ~60% of MetaGPT calls, ~40% of Open Operator calls, ~70% of Cradle calls replaceable by SLMs. https://arxiv.org/html/2506.02153

### 2025–26 papers on planning with 1–4B models (short)

- **COPE / Efficient LLM Collaboration via Planning**: Llama-1B/3B plans made a stronger executor _worse_ than no plan (GPT-mini on MATH-500: 73.8% no plan → 70.6% with Llama-3B plans → 69.6% with Llama-1B plans); "low-quality plans generated by smaller models can hinder the execution ability of larger models". https://arxiv.org/html/2506.11578v3
- **Beyond ReAct (planner-centric DAG)**: Qwen3-8B planner hits 59.8% Solvable Pass Rate on StableToolBench vs GPT-4 ReAct 48.2%; but on the Hard split Qwen3-1.7B and Qwen3-4B reach only 21.8% and 25.9% DAG exact match even after SFT (3,000 instances) + GRPO (787). https://arxiv.org/html/2511.10037v1
- **Pre-Act**: a multi-step plan revised after every tool result beats ReAct by 70% Action Recall (Almita); fine-tuned Llama-3.1 8B/70B match or beat GPT-4. https://arxiv.org/abs/2505.09970
- **Small Models, Big Tasks (EASE 2025)**: five 1.3–3.8B models; zero-shot JSON parsability 7.34% for Deepseek-Coder-1.3B and 0% for the rest; 3-shot lifts Deepseek-Coder to 89.38% parsable / 55.65% task accuracy while Phi-3-mini, Phi-2, StarCoder2 still cannot hold the format; fine-tuned Phi-3-mini reaches 99.62% / 87.27%. https://arxiv.org/html/2504.19277
- **CAMPHOR (Apple)**: on-device high-order reasoning agent decomposes tasks and coordinates expert agents (context retrieval, tool use, dynamic planning) with parameter sharing and prompt compression; fine-tuned SLM agents ~35% higher task-completion F1 than closed LLMs. https://arxiv.org/abs/2410.09407
- **Efficient On-Device Agents via Adaptive Context Management**: a 3B agent with a LoRA "Context State Object" memory, minimalist tool-schema serialization, and just-in-time schema loading; >6x smaller system prompt, 10–25x slower context growth, accuracy matched or exceeded baseline. https://arxiv.org/abs/2511.03728
- **Dynamic Tool Dependency Retrieval**: tool shortlist conditioned on the query _and the evolving plan_, 23–104% over static retrievers. https://arxiv.org/abs/2512.17052
- **Task-Decoupled Planning**: Supervisor → DAG of sub-goals, each planned/executed in a scoped context; up to 82% fewer tokens vs "entangled" monolithic histories. https://arxiv.org/abs/2601.07577
- **SLM agentic survey**: recommends "SLM-default, LLM-fallback systems with uncertainty-aware routing and verifier cascades"; "guided decoding, strict JSON Schema outputs, and validator-first tool execution close much of the capability gap". https://arxiv.org/abs/2510.03847

---

## 2. Planner / prompt shapes

### LLMCompiler planner prefix (from `planner.py`, quoted as returned by the fetch)

```
Given a user query, create a plan to solve it with the utmost parallelizability.
Each action described above contains input/output types and description.
  - You must strictly adhere to the input and output types for each action.
  - Each action MUST have a unique ID, which is strictly increasing.
  - Inputs for actions can either be constants or outputs from preceding actions.
    In the latter case, use the format $id to denote the ID of the previous action
    whose output will be the input.
  - Always call join as the last action in the plan. Say '<END_OF_PLAN>' after you call join.
  - Ensure the plan maximizes parallelizability.
  - Only use the provided action types. ... Never introduce new actions other than the ones provided.
join(): Collects and combines results from prior actions. A LLM agent is called upon
invoking join to either finalize the user query or wait until the plans are executed.
```

Replan suffix: "You are given 'Previous Plan' which is the plan that the previous agent created along with the execution results ... You MUST use these information to create the next plan under 'Current Plan' ... In the Current Plan, you should NEVER repeat the actions that are already executed." Joiner outputs are the constants `Finish` / `Replan`; end-of-plan marker is `<END_OF_PLAN>`. https://github.com/SqueezeAILab/LLMCompiler/blob/main/src/llm_compiler/planner.py , https://github.com/SqueezeAILab/LLMCompiler/blob/main/src/llm_compiler/constants.py

Example plan (ParallelQA config):

```
Question: If cheetah was 1.3 times slower, greyhound was 1.5 times faster ... ratio of the fastest animal to the slowest animal?
1. search("cheetah")
2. math("cheetah max speed in km/h if 1.3 times slower?", ["$1"])
3. search("greyhound")
...
8. join()
```

https://github.com/SqueezeAILab/LLMCompiler/blob/main/configs/parallelqa/gpt_prompts.py

### TinyAgent planner instructions (from `prompts.py`, quoted as returned by the fetch)

```
You need to start your plan with the '1.' call
Today's date is <date>
Unless otherwise specified, the default meeting duration is 60 minutes
Do not use named arguments in your tool calls
You MUST end your plans with the 'join()' call and a '\n' character
You MUST fill every argument in the tool calls, even if they are optional
The format for dates MUST be in ISO format of 'YYYY-MM-DD HH:MM:SS'
If you want to use the result of a previous tool call, you MUST use the '$' sign followed by the index of the tool call
Before sending an email, you MUST use the get_email_address tool ...
Before sending an SMS, you MUST use the get_phone_number tool ...
You MUST ONLY USE join() at the very very end of the plan, or you WILL BE PENALIZED
```

Example: `1. get_phone_number("Contact Name")\n2. send_sms(["$1"], "Message")\n3. join()`. Retrieved in-context examples are concatenated with `###\n` separators. Joiner: "You MUST only output either JOINNER_FINISH or JOINNER_REPLAN, or you WILL BE PENALIZED. ... If the plan is fixable, you will see a message like 'try again'... If you don't see this message, the error is NOT fixable and you MUST output an error message using 'Action: JOINNER_FINISH(<your error message>)'"; summaries return `JOINNER_FINISH(SUMMARY_RESULT)`; on the final attempt only FINISH is allowed. https://github.com/SqueezeAILab/TinyAgent/blob/main/src/tiny_agent/prompts.py , https://github.com/SqueezeAILab/TinyAgent/blob/main/src/tiny_agent/tool_rag/base_tool_rag.py

### Octopus v2 output grammar

```
single:   <nexa_i>(param1, param2, ...)<nexa_end>
parallel: <nexa_i>(...); <nexa_j>(...)<nexa_end>
nested:   <nexa_i>(param1, <nexa_j>(...), ...)<nexa_end>
```

`<nexa_end>` doubles as the stop token so no function descriptions are needed at inference. https://arxiv.org/html/2404.01744v6

### Apple tool definition guidance (WWDC25 session 301, verbatim)

"It's best to make your tool name short, but still readable as English text. Avoid abbreviations, and don't make your description too long, or explain any of the implementations. Because remember, these strings are put verbatim in your prompt. So longer strings means more tokens, which can increase the latency. Instead, consider using a verb in the name, such as findContact. And your description should be about one sentence." Also: "a tool can be called multiple times for a single request. And when that happens, your tool gets called in parallel." https://developer.apple.com/videos/play/wwdc2025/301/

### Apple orchestration patterns (WWDC26 session 242, verbatim)

Baton-pass: "Two or more profiles, typically each leveraging different models; a variable that controls which profile is active; each profile has a tool that allows the model to set that variable ... The full transcript history is visible to both profiles." Phone-a-friend: "A tool spawns a short-lived session with an independent transcript ... The parent profile is always responsible for giving the final answer." History: "historyTransform can be applied to a profile to transform the history prior to prompting the model ... Transforms don't permanently mutate the session's transcript." Summarization hook: `.onResponse { if history.count > 50 ... summary = try await summarize(history[0..<responseIndex]); history = history[responseIndex...] }`. https://developer.apple.com/videos/play/wwdc2026/242/

### TN3193 recovery sample (verbatim)

```swift
func newContextualSession(with originalSession: LanguageModelSession) -> LanguageModelSession {
    let allEntries = originalSession.transcript
    let condensedEntries = [allEntries.first, allEntries.last].compactMap { $0 }
    let condensedTranscript = Transcript(entries: condensedEntries)
    var newSession = LanguageModelSession(transcript: condensedTranscript)
    newSession.prewarm()
    return newSession
}
```

https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window

---

## 3. The numbers

### TinyAgent (https://arxiv.org/html/2409.00608v3 unless noted)

| Item                                         | Value                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tools                                        | 16 Mac functions + 3 sub-agents (https://github.com/SqueezeAILab/TinyAgent)                                                                                                                                                                                                                                                             |
| Training data                                | 80,000 train / 1,000 val / 1,000 test plans, GPT-4-Turbo-generated, ~$500; plans sanity-checked as feasible graphs; success = DAG isomorphism with ground truth. (The HF ToolRAG card says "40,000 real-life use cases" with GPT-3.5-Turbo instructions and GPT-4-Turbo plans: https://huggingface.co/squeeze-ai-lab/TinyAgent-ToolRAG) |
| Fine-tune                                    | LoRA, 3 epochs, lr 7e-5, negative-sample tools + RAG-retrieved in-context examples in the training prompts                                                                                                                                                                                                                              |
| Success before → after FT                    | 1.1B: 12.71% → 78.89%; 7B: 41.25% → 83.09%                                                                                                                                                                                                                                                                                              |
| Baselines                                    | GPT-3.5 65.04%; GPT-4-Turbo 79.08%                                                                                                                                                                                                                                                                                                      |
| ToolRAG table                                | No RAG: recall 1.0, 2,762 prompt tokens, 78.89% / 83.09%. Basic RAG top-3: recall 0.949, 1,674 tokens, 74.88% / 78.50%. DeBERTa: recall 0.998, 1,397 tokens, 80.06% / 84.95%; avg 3.97 tools retrieved                                                                                                                                  |
| ToolRAG mechanics                            | DeBERTa-v3-small, 16 labels, sigmoid > 0.5, tokenizer max_length 512; examples via cosine similarity on `text-embedding-3-small`, top-k restricted to retrieved tools (https://github.com/SqueezeAILab/TinyAgent/blob/main/src/tiny_agent/tool_rag/classifier_tool_rag.py)                                                              |
| Latency (MacBook Pro M3, end-to-end planner) | 1.1B FP16 3.9 s / 2.2 GB; 1.1B 4-bit 2.9 s / 0.68 GB / 80.35%; 7B FP16 19.5 s / 14.5 GB; 7B 4-bit 13.1 s / 4.37 GB / 85.14%; GPT-4-Turbo 3.9 s                                                                                                                                                                                          |
| Quantization                                 | 4-bit, group size 32, llama.cpp; ~30% better latency, 4x smaller                                                                                                                                                                                                                                                                        |
| Caveat                                       | "Adding your own tools only works for GPT models since our open-source models and ToolRAG were only fine-tuned on the original TinyAgent toolset." (https://github.com/SqueezeAILab/TinyAgent)                                                                                                                                          |

### LLMCompiler (https://arxiv.org/html/2312.04511)

| Benchmark                                                                                                                                                                       | LLMCompiler                       | ReAct           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | --------------- |
| HotpotQA (GPT)                                                                                                                                                                  | 62.00%, 3.95 s, 1.80x             | 62.47%, 7.12 s  |
| Movie Rec (GPT)                                                                                                                                                                 | 77.13%, 5.47 s, 3.74x             | 72.47%, 20.47 s |
| ParallelQA (GPT-4)                                                                                                                                                              | 89.38%, 16.69 s, 2.15x            | 89.09%, 35.90 s |
| Game of 24 (GPT-4)                                                                                                                                                              | 75.33%, 2.89x vs Tree-of-Thoughts | —               |
| Cost reduction 3.37–6.73x vs ReAct; LLaMA-2 70B speedups 1.40–2.27x; streaming plan adds up to 1.3x; ~9% accuracy gain on ParallelQA with LLaMA-2 from avoiding early stopping. |

### Octopus v2 (https://arxiv.org/html/2404.01744v6)

| Model                                                                                                                                                                                    | Accuracy | Latency/call |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------ |
| Octopus-0 (2B, 1K samples/API)                                                                                                                                                           | 99.524%  | 0.38 s       |
| GPT-4                                                                                                                                                                                    | 98.571%  | 1.02 s       |
| GPT-3.5                                                                                                                                                                                  | 97.143%  | 1.18 s       |
| Llama-7B + RAG                                                                                                                                                                           | 68.095%  | 13.46 s      |
| 20 APIs; 1,000 pos + 1,000 neg per API; 95% context reduction; ~4K samples/API for parallel/nested parity. Octo-planner: 3.8B planner, 97% in-domain (https://arxiv.org/abs/2406.18082). |

### Apple

| Item                        | Value                                                                                              | Source                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| On-device params            | ~3B, KV-cache sharing, 2-bit QAT                                                                   | https://arxiv.org/html/2507.13575v1                                                                                                |
| Context (iOS 26)            | 4,096 tokens per session, "always 4096"                                                            | https://developer.apple.com/forums/thread/806542                                                                                   |
| Context (current gen)       | `contextSize` 8,192 on the current on-device generation; PCC 32K                                   | https://peterfriese.dev/blog/2026/hybrid-ai-apple-foundation-models-gemini , https://developer.apple.com/videos/play/wwdc2026/241/ |
| Token ≈ chars               | 3–4 Latin chars; ~1 CJK char                                                                       | TN3193                                                                                                                             |
| Prompt length guidance      | 1–3 paragraphs max                                                                                 | TN3193                                                                                                                             |
| Tool count guidance         | "maximum of 3–5 tools"                                                                             | TN3193                                                                                                                             |
| Example tool cost           | a trivial tool set measured at 68 tokens; instructions 16; prompt 14 (illustrative)                | https://artemnovichkov.com/blog/tracking-token-usage-in-foundation-models                                                          |
| Utilities summarize trigger | rolling window of 10 entries, summarize if > 5,000 tokens                                          | https://github.com/apple/foundation-models-utilities                                                                               |
| Tool error semantics        | on a thrown tool error "the framework rolls back the transcript to a previously known valid state" | https://developer.apple.com/documentation/foundationmodels/expanding-generation-with-tool-calling                                  |

### Small-model planning (2025–26)

| Finding                                             | Number                                                  | Source                              |
| --------------------------------------------------- | ------------------------------------------------------- | ----------------------------------- |
| 1B/3B plans hurt a stronger executor                | 73.8% → 70.6% (3B plans) → 69.6% (1B plans), MATH-500   | https://arxiv.org/html/2506.11578v3 |
| One-shot DAG planner, 8B                            | 59.8% vs GPT-4 ReAct 48.2% (StableToolBench)            | https://arxiv.org/html/2511.10037v1 |
| One-shot DAG planner, 1.7B / 4B, Hard, after SFT+RL | 21.8% / 25.9% DAG exact match                           | https://arxiv.org/html/2511.10037v1 |
| Zero-shot JSON parsability, 1.3–3.8B                | 7.34% best, 0% others                                   | https://arxiv.org/html/2504.19277   |
| 3-shot, Deepseek-Coder-1.3B                         | 89.38% parsable, 55.65% task accuracy                   | https://arxiv.org/html/2504.19277   |
| Fine-tuned Phi-3-mini                               | 99.62% parsable, 87.27% task accuracy                   | https://arxiv.org/html/2504.19277   |
| SLM-replaceable calls in real agents                | MetaGPT ~60%, Open Operator ~40%, Cradle ~70%           | https://arxiv.org/html/2506.02153   |
| 3B agent with JIT schema loading                    | >6x smaller system prompt, 10–25x slower context growth | https://arxiv.org/abs/2511.03728    |

---

## 4. What Goliath should change

Each item is numbered, concrete, and testable. "Eval set" below means a fixed, versioned set of ~100 user asks over Goliath's tool set with a ground-truth call graph (TinyAgent scored plans by DAG isomorphism against ground truth: https://arxiv.org/html/2409.00608v3). Build it first; every recommendation below is judged against it.

### Verdict on the three headline questions

**Q1. Should the step-at-a-time conductor become a one-shot DAG plan for simple asks?** Yes, but narrowly: a _short_ one-shot plan (≤3 steps, `$N` references, no branching) for asks whose whole call graph is determinable from the query, validated statically before execution, with LLMCompiler-style replan-on-failure. Not a general DAG planner. Evidence for: LLMCompiler removes ReAct's two SLM-lethal failure modes (loops and early stopping: https://arxiv.org/html/2312.04511); TinyAgent shows a 1.1B model _can_ emit correct 1–4-step DAGs at 80% — but only after 80k-example LoRA (https://arxiv.org/html/2409.00608v3); Apple's own framework already computes "the potentially complex call graphs of parallel and serial tool calls" from one request, i.e. Apple trained the 3B model to plan several calls at once (https://arxiv.org/html/2507.13575v1). Evidence against going further: un-tuned 1–3B planners produce plans worse than no plan (https://arxiv.org/html/2506.11578v3) and even SFT+RL 4B planners hit 25.9% DAG exact match on hard multi-tool tasks (https://arxiv.org/html/2511.10037v1). So: one-shot for the easy band, step-at-a-time (which Pre-Act shows is the stronger shape for revising after each tool output: https://arxiv.org/abs/2505.09970) for everything else.

**Q2. Does ToolRAG-style shortlisting belong in the conductor?** Only once the tool count exceeds Apple's 3–5 guidance (https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window). TinyAgent's gain from ToolRAG was +1.2/+1.9 points and a 2x prompt cut at 16 tools, but its basic top-3 RAG _lost_ 4–5 points (recall 0.949), so a bad shortlister is worse than none (https://arxiv.org/html/2409.00608v3). Goliath cannot train a DeBERTa per app; use an on-device embedding shortlist with a high-recall threshold (≥0.99 recall on the eval set) and always include a small always-on core.

**Q3. What would few-shot examples do for a 3B model's plan quality?** Format is not the problem — Apple's guided generation makes the structure valid by construction (https://arxiv.org/html/2507.13575v1), which is the failure the 1–4B literature mostly measures (https://arxiv.org/html/2504.19277). Examples buy _semantic_ correctness: which tool, prerequisite ordering, argument conventions. TinyAgent baked retrieved examples into both training and inference prompts and its prompt with examples + ~4 tools was 1,397 tokens (https://arxiv.org/html/2409.00608v3). Budget 2–3 short retrieved examples (~150–250 tokens) in the conductor and one canonical example per tool in the worker, and measure.

### Numbered changes

1. **Add a "short plan" branch to the conductor.** Extend the plan schema so `kind: plan` carries `steps: [{tool, brief, uses: [stepIndex]}]` with max 3 steps; keep `tool|answer|escalate` for the rest. Execute steps in order, substituting prior results by `$N` exactly as TinyAgent/LLMCompiler do (https://github.com/SqueezeAILab/TinyAgent/blob/main/src/tiny_agent/prompts.py). Test: on the eval set, one-shot plans must match or beat step-at-a-time on task success while using fewer model calls (k+1 vs 2k for k steps). Ship only if both hold.

2. **Validate every plan statically before running it, and treat validation failure as a hinted retry.** TinyAgent ran "sanity checks on the function calling plan to make sure that they form a feasible graph" and checked names and argument types (https://arxiv.org/html/2409.00608v3); LLMCompiler's rules are "unique ID, strictly increasing", "$id" only to preceding actions, "only use the provided action types" (https://github.com/SqueezeAILab/LLMCompiler/blob/main/src/llm_compiler/planner.py). Checks: tool in shortlist, `uses` only references earlier steps, no step repeats a completed `(tool, args)`, write-tools carry a confirmation step. Test: a corpus of hand-written bad plans must all be rejected with a specific hint; no valid plan rejected.

3. **Make `tool` an enum of the shortlisted tool names in the structured-output schema, never a free string.** Apple's constrained decoding "guarantee[s] the structural correctness of tool calls by preventing hallucinated tool names" only when the name is in the schema (https://arxiv.org/html/2507.13575v1); the SLM survey calls this "schema-first prompting, type-safe function registries" (https://arxiv.org/abs/2510.03847). Test: a fuzz run of 200 asks yields zero unknown-tool plans.

4. **Adopt LLMCompiler's joiner contract for the post-plan check: exactly two outcomes, Finish or Replan, and Replan is fed the executed steps with "NEVER repeat the actions that are already executed".** (https://github.com/SqueezeAILab/LLMCompiler/blob/main/src/llm_compiler/planner.py , https://github.com/SqueezeAILab/LLMCompiler/blob/main/src/llm_compiler/constants.py). TinyAgent refines this: Replan is only allowed when the executor's error says "try again"; otherwise Finish with an error (https://github.com/SqueezeAILab/TinyAgent/blob/main/src/tiny_agent/prompts.py). Map onto Goliath: tool errors tagged retryable → one replan; non-retryable → escalate with step log. Test: repeated-call escalations on the eval set drop to zero because repeats are excluded at the schema/validator level rather than detected after the fact.

5. **Generate TinyAgent-style prerequisite rules from tool metadata instead of hoping the model infers them.** TinyAgent's biggest plan-shape lever was prompt lines like "Before sending an email, you MUST use the get_email_address tool" (https://github.com/SqueezeAILab/TinyAgent/blob/main/src/tiny_agent/prompts.py). Add `requires: ["lookupContact"]` to tool definitions and render one sentence per rule into the conductor prompt; also render "Today's date is …", "fill every argument, even optional ones", and "dates in ISO YYYY-MM-DD HH:MM:SS". Test: prerequisite-ordering errors on the eval set go to zero.

6. **Shortlist tools only above five, with an on-device embedding classifier tuned for recall.** Rationale and thresholds in Q2 above. Implementation: embed each tool's name + one-sentence description; keep tools with cosine ≥ τ plus an always-on core (answer/escalate/confirm); choose τ on the eval set for recall ≥ 0.99 (TinyAgent's DeBERTa hit 0.998; its top-3 baseline at 0.949 cost 4–5 points: https://arxiv.org/html/2409.00608v3). Consider re-running the shortlist after each executed step (Dynamic Tool Dependency Retrieval conditions on "the evolving tool calling plan": https://arxiv.org/abs/2512.17052). Test: tool recall and conductor prompt tokens per ask, both logged.

7. **Add retrieved few-shot examples to the conductor (2–3) and a fixed canonical example per tool to the worker (1).** TinyAgent retrieves top-k examples by cosine similarity restricted to the retrieved tools and joins them with `###` (https://github.com/SqueezeAILab/TinyAgent/blob/main/src/tiny_agent/tool_rag/base_tool_rag.py). Examples should show the _brief → args_ mapping, not prose. Test: A/B on the eval set, 0 vs 2 vs 3 examples; keep the smallest count whose success is within 1 point of the best, and log tokens.

8. **Read `contextSize` and `tokenCount(for:)` at runtime; stop hard-coding 4,096.** DTS says 4,096 "is always the fixed token limit" on iOS 26 (https://developer.apple.com/forums/thread/806542), but the current generation reports 8,192 (https://peterfriese.dev/blog/2026/hybrid-ai-apple-foundation-models-gemini) and the APIs are back-deployed (https://infoq.com/news/2026/03/apple-foundation-models-context). Budget each call as instructions + tools + examples + brief + expected output and refuse (escalate) when the budget is exceeded before the model throws `exceededContextWindowSize`. Test: zero context-window exceptions in the eval run; the conductor's budget log agrees with `tokenCount(for:)` within 5%.

9. **Keep tool definitions tiny and count them.** Tool names/descriptions "are put verbatim in your prompt" (https://developer.apple.com/videos/play/wwdc2025/301/); descriptions should be "about one sentence"; TN3193: short `@Guide` phrases. Adaptive Context Management got a >6x system-prompt cut largely from minimalist schema serialization and just-in-time schema loading (https://arxiv.org/abs/2511.03728) — which Goliath's one-tool-per-worker design already is; extend the same discipline to the conductor's shortlist (names + one line, no schemas). Test: conductor prompt ≤ 1,000 tokens at 5 tools; worker prompt ≤ 600 tokens.

10. **Run deterministic pre-fetches instead of tool calls when the model always needs the value.** TN3193: "Consider running tools directly before calling the model instead of using tool calling when the model should always have the information" (https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window). For Helen-style asks: today's date, timezone, current user, the active thread — inject as `key: value` lines, never as tools. Test: count of tool steps per eval ask drops; success unchanged.

11. **Formalize the worker as Apple's phone-a-friend and the conductor as the parent that always answers.** Apple's stated invariant: "The parent profile is always responsible for giving the final answer" and child transcripts are isolated (https://developer.apple.com/videos/play/wwdc2026/242/). Goliath already does this; write it down as an invariant and test it: no worker output reaches the user unmediated.

12. **Do not mix tools and guided generation on the same session.** A practitioner building a coordinator/planner/worker agent on the 3B model found "The root or coordinator model mustn't have any 'generating' type when using tool calling" — removing guided output fixed inconsistent tool invocation (https://www.natashatherobot.com/p/ai-agents-apples-foundation-models-tool-calling). Goliath's design (conductor: structured output, no tools; worker: structured output, no tools; Goliath runs tools) sidesteps this — keep it as a hard rule and add a lint that no session gets both `tools` and a `Generable` output type.

13. **Align the scribe with Apple's history modifiers and make it measurable.** The utilities package composes "drop completed tool calls → rolling window → summarize" with a token trigger (https://github.com/apple/foundation-models-utilities); TN3193's minimum viable condensation keeps the first and last transcript entries. Keep the 60-word Goal/Done/Decisions/Pending/Next brief, but trigger the rewrite on measured tokens (`tokenCount(for:)`) rather than turns, and drop completed tool I/O first. Test: the brief never exceeds 120 tokens; a 10-step eval ask completes without a context error.

14. **Use validation as the uncertainty signal you cannot get from logprobs.** The survey's "uncertainty-aware routing and verifier cascades" (https://arxiv.org/abs/2510.03847) and NVIDIA's "LLMs invoked selectively and sparingly" (https://arxiv.org/html/2506.02153) both assume a router. Goliath's escalation triggers already are a verifier cascade; add two: (a) static plan-validation failure after the hinted retry, (b) a worker-args validation failure (required arg missing, `$N` unresolved). Test: escalation precision on the eval set — the share of escalations where the cloud actually changed the outcome — is tracked and ≥ 70%.

15. **Log every conductor/worker call as training data, even if you never train.** NVIDIA's S1–S3 (instrument, scrub, cluster) is cheap and the clusters tell you which asks are "easy band" for the one-shot plan and which tools are never chosen (https://arxiv.org/html/2506.02153). TinyAgent's eval is exactly such a log with ground-truth graphs. Test: the eval set is regenerated from logs quarterly.

16. **Measure latency per step the way TinyAgent did — end-to-end planner time including prompt processing — on the slowest supported device.** TinyAgent's 1.1B 4-bit planner took 2.9 s on an M3 for a whole plan (https://arxiv.org/html/2409.00608v3); Goliath pays two generations per step. Budget: p50 ≤ 3 s per step on an A17-class phone, or the one-shot branch (change 1) is justified on latency alone. Test: a latency table by device in CI artifacts.

---

## 5. What does not transfer, and why

1. **Fine-tuning is the load-bearing ingredient in every strong small-model planner, and Goliath cannot do it.** TinyAgent went 12.71% → 78.89% (1.1B) purely through LoRA on 80k plans (https://arxiv.org/html/2409.00608v3); Octo-planner's 97% is a Phi-3-Mini fine-tune (https://arxiv.org/abs/2406.18082); Beyond ReAct's planner is SFT+GRPO (https://arxiv.org/html/2511.10037v1); Pre-Act's wins come from fine-tuned Llama (https://arxiv.org/abs/2505.09970). Apple exposes LoRA adapters, but adapters must be retrained per OS model version and forum reports say adapter models do not invoke tools (https://developer.apple.com/forums/topics/machine-learning-and-ai/machine-learning-and-ai-foundation-models?sortBy=replies&sortOrder=desc&open-dropdown=true). Goliath should treat prompt + schema + validator as its whole lever, and expect the un-tuned floor: COPE's 1–3B planners _lowered_ accuracy (https://arxiv.org/html/2506.11578v3).

2. **Functional tokens require tokenizer surgery.** Octopus adds `<nexa_i>` tokens to the vocabulary and trains the model to emit them (https://arxiv.org/html/2404.01744v6). Apple's tokenizer is not extensible and its model is fixed. The nearest equivalent Goliath already has — an enum of tool names under constrained decoding — captures the "cannot hallucinate a name" property (https://arxiv.org/html/2507.13575v1) but not the 95% context saving, because tool descriptions still have to be in the prompt.

3. **Octopus' accuracy and latency numbers describe a 20-API closed set with ~1–4K training samples per API.** The paper "assumes the set of possible function names is fixed" and adds new APIs by regenerating data and retraining (https://arxiv.org/html/2404.01744v6). Goliath's tool set is app-defined and changes at build time.

4. **LLMCompiler's speedups are mostly parallel-execution speedups, and Apple serializes.** Up to 3.7x came from running independent calls concurrently and streaming the plan into the executor (https://arxiv.org/html/2312.04511); with one request in flight on the Neural Engine, only tool I/O (network, disk) can overlap, not model calls. What survives is the _call-count_ saving (one planning call instead of k) and the loop/early-stop immunity, which is why change 1 is scoped to short plans rather than "maximize parallelizability".

5. **Streaming a plan into the executor does not apply to guided JSON output.** LLMCompiler regex-parses tokens as they arrive (https://arxiv.org/html/2312.04511); Goliath gets a structured object at the end. Gain foregone: up to 1.3x when tools are slow. Not worth re-introducing free-text plans to recover it.

6. **TinyAgent's ToolRAG is a supervised 16-way classifier trained on the same 80k plans.** DeBERTa-v3-small with sigmoid > 0.5 (https://github.com/SqueezeAILab/TinyAgent/blob/main/src/tiny_agent/tool_rag/classifier_tool_rag.py) and the README warns the classifier "only" knows the original toolset (https://github.com/SqueezeAILab/TinyAgent). Goliath's substitute is an untrained embedding threshold, which is closer to TinyAgent's _basic RAG_ baseline — the one that lost 4–5 points — hence the recall ≥ 0.99 gate in change 6.

7. **TinyAgent's prompt sizes assume a 32K window.** Its base is TinyLlama-1.1B-32K-Instruct (https://huggingface.co/squeeze-ai-lab/TinyAgent-ToolRAG) and its no-RAG prompt is 2,762 tokens (https://arxiv.org/html/2409.00608v3), which alone would consume two-thirds of a 4,096 window that also has to hold the output. Its token counts are a ceiling to stay far under, not a target.

8. **The few-shot literature on 1–4B models mostly measures format failure that Apple has already removed.** "Small Models, Big Tasks" found zero-shot JSON parsability of 7% or 0% and that 3-shot fixed it for one model but not for Phi-3-mini (https://arxiv.org/html/2504.19277). With guided generation the output is well-formed by construction (https://arxiv.org/html/2507.13575v1), so those gains do not stack; only the semantic effect of examples (tool choice, prerequisites, argument conventions) remains, and it must be measured fresh (change 7).

9. **Logprob-based routing and confidence scoring.** The SLM survey's "uncertainty-aware routing" and "confidence scoring with verifier rollups" (https://arxiv.org/abs/2510.03847) assume token probabilities; Apple exposes none. Goliath's verifiers must be structural (change 14).

10. **Apple's Dynamic Profiles, `historyTransform`, and the utilities package are Swift-side APIs on `LanguageModelSession`.** Goliath drives the model from React Native through the Vercel AI SDK, so baton-pass/phone-a-friend and the history modifiers (https://developer.apple.com/videos/play/wwdc2026/242/ , https://github.com/apple/foundation-models-utilities) are patterns to mirror in TypeScript, not code to call — unless the native bridge exposes profiles, in which case the scribe could become a `historyTransform`.

11. **NVIDIA's case-study percentages (60/40/70%) are about replacing cloud LLM calls inside cloud agents with fine-tuned SLMs** (https://arxiv.org/html/2506.02153); they say nothing about an un-tuned 3B on a phone. What transfers is the architecture claim — SLM by default, LLM sparingly — which Goliath's escalation ladder already embodies.

12. **CAMPHOR and Adaptive Context Management both rely on fine-tuned specialist agents / LoRA memory adapters** (https://arxiv.org/abs/2410.09407 , https://arxiv.org/abs/2511.03728). Their _structural_ ideas — scoped contexts per sub-task, JIT schema loading, minimalist serialization — transfer; their accuracy numbers do not.

---

## Sources (all)

- TinyAgent abs https://arxiv.org/abs/2409.00608 ; HTML https://arxiv.org/html/2409.00608v3 ; repo https://github.com/SqueezeAILab/TinyAgent ; prompts https://github.com/SqueezeAILab/TinyAgent/blob/main/src/tiny_agent/prompts.py ; ToolRAG code https://github.com/SqueezeAILab/TinyAgent/blob/main/src/tiny_agent/tool_rag/classifier_tool_rag.py , https://github.com/SqueezeAILab/TinyAgent/blob/main/src/tiny_agent/tool_rag/base_tool_rag.py ; ToolRAG card https://huggingface.co/squeeze-ai-lab/TinyAgent-ToolRAG ; BAIR blog (unreachable at research time, ECONNREFUSED) https://bair.berkeley.edu/blog/2024/05/29/tiny-agent/
- LLMCompiler abs https://arxiv.org/abs/2312.04511 ; HTML https://arxiv.org/html/2312.04511 ; repo https://github.com/SqueezeAILab/LLMCompiler ; planner https://github.com/SqueezeAILab/LLMCompiler/blob/main/src/llm_compiler/planner.py ; constants https://github.com/SqueezeAILab/LLMCompiler/blob/main/src/llm_compiler/constants.py ; ParallelQA prompts https://github.com/SqueezeAILab/LLMCompiler/blob/main/configs/parallelqa/gpt_prompts.py
- Octopus v2 https://arxiv.org/abs/2404.01744 , https://arxiv.org/html/2404.01744v6 , https://huggingface.co/NexaAI/Octopus-v2 ; v3 https://arxiv.org/abs/2404.11459 ; v4 https://arxiv.org/abs/2404.19296 ; Octo-planner https://arxiv.org/abs/2406.18082
- Apple: tech report https://arxiv.org/html/2507.13575v1 , https://machinelearning.apple.com/research/apple-foundation-models-tech-report-2025 ; TN3193 https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window ; tool calling doc https://developer.apple.com/documentation/foundationmodels/expanding-generation-with-tool-calling ; WWDC25 301 https://developer.apple.com/videos/play/wwdc2025/301/ ; WWDC25 286 https://developer.apple.com/videos/play/wwdc2025/286/ ; WWDC26 241 https://developer.apple.com/videos/play/wwdc2026/241/ ; WWDC26 242 https://developer.apple.com/videos/play/wwdc2026/242/ (notes: https://wwdc.ai/2026/242) ; utilities https://github.com/apple/foundation-models-utilities ; DTS forum https://developer.apple.com/forums/thread/806542 ; forum index https://developer.apple.com/forums/topics/machine-learning-and-ai/machine-learning-and-ai-foundation-models?sortBy=replies&sortOrder=desc&open-dropdown=true ; contextSize/tokenCount coverage https://infoq.com/news/2026/03/apple-foundation-models-context , https://artemnovichkov.com/blog/tracking-token-usage-in-foundation-models , https://peterfriese.dev/blog/2026/hybrid-ai-apple-foundation-models-gemini , https://zats.io/blog/making-the-most-of-apple-foundation-models-context-window/ , https://chatforest.com/builders-log/apple-foundation-models-ios-27-on-device-llm-api-builder-guide/ ; practitioner agent write-up https://www.natashatherobot.com/p/ai-agents-apples-foundation-models-tool-calling ; CAMPHOR https://arxiv.org/abs/2410.09407
- NVIDIA SLM position paper https://arxiv.org/abs/2506.02153 , https://arxiv.org/html/2506.02153
- 2025–26 planning: COPE https://arxiv.org/html/2506.11578v3 ; Beyond ReAct https://arxiv.org/html/2511.10037v1 ; Pre-Act https://arxiv.org/abs/2505.09970 ; Small Models Big Tasks https://arxiv.org/html/2504.19277 ; Adaptive Context Management https://arxiv.org/abs/2511.03728 ; DTDR https://arxiv.org/abs/2512.17052 ; Task-Decoupled Planning https://arxiv.org/abs/2601.07577 ; efficient-agents review https://arxiv.org/abs/2601.14192 ; SLM agentic survey https://arxiv.org/abs/2510.03847
