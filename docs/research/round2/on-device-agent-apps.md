# On-device agent apps and small-model harnesses — research brief for Goliath

Round 2, 2026-09-03. Scope: shipped or open-source agents that run on phones/laptops with small local models, and minimal harnesses built for small models. Every claim carries a URL. Where a fetch returned a paraphrase rather than the page text, the passage is marked _(paraphrased by fetch)_; everything in a code block or quotation marks was returned verbatim.

Goliath today, for reference: a conductor plans one flat JSON step at a time (`{kind: tool|answer|escalate, tool, brief}`); each worker gets a fresh context and one tool and returns only the arguments as structured output; Goliath runs the tool; results compress to `key: value` lines; writes confirm first; repeated call / empty answer (after one nudge) / malformed plan (after one hinted retry) / model error escalate to a cloud fallback with the step log; a scribe keeps a 60-word brief with slots Goal/Done/Decisions/Pending/Next.

---

## 1. Each system in five lines

### 1.1 Private Mind (Software Mansion)

1. A React Native chat app on `react-native-executorch` and `react-native-rag`, on the App Store and Play Store; "All conversations happen locally, with no data sent to the cloud" and "Once a model is downloaded, every feature works without an internet connection" — https://github.com/software-mansion-labs/private-mind
2. Agentic surface: **none**. Features are chat, "Chat With Your Documents" (PDF/TXT/MD/HTML/CSV with on-device retrieval and cited passages), image input for vision models, on-device dictation, conversation branching, saved system-prompt presets, and built-in benchmarks — https://github.com/software-mansion-labs/private-mind . No tools, no tool calling, no agent loop, no long-term memory appear in the README or any release note — https://github.com/software-mansion-labs/private-mind/releases
3. Models: "Qwen 3 and LLaMA 3.2 and their different quantizations", Gemma 4 via an updated executorch, Bielik; downloads are "about 1 to 3 GB each" — https://apps.apple.com/us/app/private-mind/id6746713439 , https://github.com/software-mansion-labs/private-mind/releases . Onboarding "picks default models from the phone's available RAM instead of a fixed list" — https://github.com/software-mansion-labs/private-mind/releases
4. Context handling: the v1.1.0 note "Move context to message instead of attaching it in system prompt" is the one prompt-shape decision on record; RAG is "Hybrid retrieval (vector + keyword) with multilingual refinements" over `all_minilm_l6_v2` embeddings and an op-sqlite vector store — https://github.com/software-mansion-labs/private-mind/releases , https://github.com/software-mansion-labs/react-native-rag
5. Harness: open source (repo above), but it is a chat harness; there is nothing to lift for planning or tool routing.

### 1.2 react-native-executorch tool calling (`useLLM`)

1. `useLLM` has two modes: "functional/pure mode where you manage state yourself using `generate` and `response`, or managed/stateful mode where the library manages conversation state and automatically parses and calls tools after passing appropriate callbacks" — https://docs.swmansion.com/react-native-executorch/docs/hooks/natural-language-processing/useLLM
2. `toolsConfig = { tools, executeToolCallback, displayToolCalls }`; it "will only have effect if your model's chat template supports it" — https://docs.swmansion.com/react-native-executorch/docs/hooks/natural-language-processing/useLLM
3. Parsing is a single regex for the first `[...]` block in the model text, `JSON.parse`, then keep entries with a string `name` and object `arguments` (source below, §2.4) — https://raw.githubusercontent.com/software-mansion/react-native-executorch/main/packages/react-native-executorch/src/utils/llm.ts
4. Tool results are appended to history with `role: 'assistant'`; there is no step limit, no repeat detection, and no per-round cap in `LLMController` _(paraphrased by fetch)_ — https://raw.githubusercontent.com/software-mansion/react-native-executorch/main/packages/react-native-executorch/src/controllers/LLMController.ts
5. Context: `chatConfig.contextStrategy` with `NoopContextStrategy`, `MessageCountContextStrategy`, or the default `SlidingWindowContextStrategy` (token-budgeted, e.g. `maxTokens: 2048`); `contextWindowLength` was deprecated in v0.8.0 — https://docs.swmansion.com/react-native-executorch/docs/hooks/natural-language-processing/useLLM , https://github.com/software-mansion/react-native-executorch/releases/tag/v0.8.0 . Tool-calling model of record is "Hammer 2.1 (1.5B)", "a specialized model trained specifically for accurate and reliable tool execution" — https://swmansion.com/blog/react-native-executorch-release-v0-4-0-262d4013ac10 . Text models span 135M–4B (SmolLM 2, Qwen 2.5/3/3.5, Phi 4 Mini, LLaMA 3.2, Bielik; LFM2.5 and Gemma 4 E2B for vision) — https://docs.swmansion.com/react-native-executorch/docs/hooks/natural-language-processing/useLLM

### 1.3 Hugging Face smolagents

1. Two agents over one `MultiStepAgent` ReAct loop: `CodeAgent` "writes its tool calls in Python code (this is the default)"; `ToolCallingAgent` "writes its tool calls in JSON" — https://huggingface.co/docs/smolagents/reference/agents
2. Defaults: `max_steps` = 20; `planning_interval` = None (off); `use_structured_outputs_internally` = False ("improves performance for many models"); `tool_choice: "required"` in the model call; `final_answer_checks` optional validators — https://huggingface.co/docs/smolagents/reference/agents , https://raw.githubusercontent.com/huggingface/smolagents/main/src/smolagents/models.py
3. Memory is the full step log; `write_memory_to_messages` "Reads past llm_outputs, actions, and observations or errors from the memory into a series of messages"; planning re-runs with `summary_mode=True` to shrink it — https://huggingface.co/docs/smolagents/reference/agents , https://raw.githubusercontent.com/huggingface/smolagents/main/src/smolagents/agents.py
4. On `max_steps` exhaustion the agent does not fail: `provide_final_answer` asks the model to answer from memory ("An agent tried to answer a user query but it got stuck and failed to do so. You are tasked with providing an answer instead.") and returns state `max_steps_error` — https://raw.githubusercontent.com/huggingface/smolagents/main/src/smolagents/prompts/toolcalling_agent.yaml , https://raw.githubusercontent.com/huggingface/smolagents/main/src/smolagents/agents.py
5. Small-model stance: "Use a stronger LLM" is debugging step 1; "You can also use less powerful models, provided you guide them more effectively"; and "Reduce the number of LLM calls as much as you can" — https://huggingface.co/docs/smolagents/tutorials/building_good_agents . Claims: core "fits in ~1,000 lines of code", code actions give "30% fewer steps" — https://raw.githubusercontent.com/huggingface/smolagents/main/README.md ; CodeAct paper: "up to 20% higher success rate" across "17 LLMs" — https://arxiv.org/abs/2402.01030

### 1.4 PocketPal AI, LLMFarm, Enchanted, MLC Chat

1. **PocketPal AI** (llama.rn / llama.cpp, GGUF, open source): the one true agent loop in this group. "A Talent is a tool the model can call mid-conversation. Engines are registered in a `TalentRegistry`, exposed to the model as tool schemas; the `AgentRunner` detects a call, runs the engine, and returns the result for the next turn." — https://github.com/a-ghorbani/pocketpal-ai
2. Built-in talents: `CalculateEngine`, `DatetimeEngine`, `RenderHtmlEngine`; releases add "structured assistant turns for tool calling" (v1.15.0), "Warn when a chat is near or at the context limit, with recovery" (v1.16.0), and "internet search to chat (web_search + read_url talents, BYOK)" (v1.17.0) — https://github.com/a-ghorbani/pocketpal-ai , https://github.com/a-ghorbani/pocketpal-ai/releases . Pals = named personas (model + system prompt) — https://github.com/a-ghorbani/pocketpal-ai
3. **LLMFarm**: features are "Various inferences, Various sampling methods, Metal, Model setting templates, Restore context state, Apple Shortcuts, RAG"; no tool calling or agent loop — https://github.com/guinmoon/LLMFarm
4. **Enchanted**: an Ollama client ("chat app for LLM researchers to chat with self hosted models"); no tools — https://github.com/gluonfield/enchanted
5. **MLC Chat**: `mlc-chat-config.json` has `use_function_calling` (default false, "helps check for output message format in API call") and `function_string`; `context_window_size` 4096 in the example; the iOS app exposes no tool UI — https://llm.mlc.ai/docs/deploy/mlc_chat_config.html

### 1.5 Android: Gemini Nano / ML Kit GenAI Prompt API / AICore / ADK

1. Stack: AICore is the system service; ML Kit GenAI APIs (Prompt, Summarization, Proofreading, Rewriting, Image Description, Speech Recognition) sit on it; Gemini Nano is on "over 140 million devices" — https://developer.android.com/ai/gemini-nano , https://android-developers.googleblog.com/2026/07/android-on-device-inference.html
2. Prompt API: beta ("This API is offered in beta, and is not subject to any SLA or deprecation policy"), artifact `1.0.0-beta3` as of July 2026; input "under 4000 tokens, approximately 3000 English words"; "use cases that require long output (more than 4K tokens) should be avoided"; streaming; `temperature/topK/maxOutputTokens/candidateCount/seed`; not on unlocked bootloaders — https://developers.google.com/ml-kit/genai/prompt/android , https://developers.google.com/ml-kit/genai/prompt/android/get-started , https://android-developers.googleblog.com/2026/07/android-on-device-inference.html
3. Structured output (Alpha): Kotlin `@Generable` / `@Guide` with `description`, `enumValues`, `minimum/maximum`, `minItems/maxItems`, nested classes, no cycles; finish reasons `STOP`, `MAX_TOKENS`, `PARSE_CLASS_ERROR`, `STRUCTURE_VALUES_INVALID` — https://developers.google.com/ml-kit/genai/prompt/android/structured-output
4. **Function calling: not in any official Google page fetched** (Prompt API overview, get-started, structured-output, Gemini Nano overview, July 2026 inference post). Third-party posts assert I/O 2026 added "on-device function calling and structured JSON output" and "roughly 32K tokens" — https://mvpfactory.io/blog/gemini-nano-on-device-function-calling-for-android-structured-output-token/ , https://dev.to/software_mvp-factory/gemini-nano-on-device-function-calling-for-android-18o3 — but their code is a hand-rolled loop (JSON extraction + schema check + bounds check), not an SDK call. Treat as unverified.
5. Google's own agent story: ADK for Android 0.1.0 wraps the on-device model as `GenaiPrompt.create(generativeModel, name = "gemini-nano")` and recommends "use a cloud-based `Gemini` for the root orchestrator and on-device `GenaiPrompt` models for sub-agents that handle privacy-sensitive tasks" — https://developer.android.com/ai/adk , https://developers.googleblog.com/adk-kotlin-android-building-ai-agents/

### 1.6 Apple: Siri AI, App Intents, Foundation Models (WWDC25/26)

1. Architecture as stated: "Siri AI uses the system orchestrator to tap into core capabilities like the Spotlight index and App Toolbox, which work entirely on device"; models "run on device and on servers using Private Cloud Compute" — https://www.apple.com/newsroom/2026/06/apple-introduces-siri-ai-a-profoundly-more-capable-and-personal-assistant/ . SotU: the Spotlight semantic index "organizes and surfaces personal context from any supported app. The app toolbox, which identifies features available across apps to serve a user request. And the system orchestrator, which coordinates it all while protecting user privacy." — https://developer.apple.com/videos/play/wwdc2026/102/ . New foundation models were co-developed with Google on Gemini technology _(paraphrased by fetch)_ — https://www.macrumors.com/2026/06/08/apple-reveals-new-ai-architecture/
2. Decomposition as exposed to developers = App Intents **schemas**: "Think of schemas as a specialization of App Intents... shaped in a way that Siri knows how to process"; entities via `AppEntity(schema:)` + `IndexedEntity` for semantic search or `EntityStringQuery`; on-screen references via view annotations; cross-app handoff via `Transferable` + `IntentValueQuery` / `IntentValueRepresentation` — https://developer.apple.com/videos/play/wwdc2026/240/ . Nothing in sessions 240/343 lets a third-party app _call_ the orchestrator or other apps' intents _(paraphrased by fetch)_ — https://developer.apple.com/videos/play/wwdc2026/343/
3. Foundation Models on-device: WWDC25 model is ~3B params at 2 bits/weight, "post-training on tool-use data", "not designed to be a chatbot for general world knowledge" — https://machinelearning.apple.com/research/apple-foundation-models-2025-updates ; context 4096 tokens, ~200 tokens per image — https://kruschel.dev/notes/wwdc26-group-labs/wwdc2026-8011 ; iOS 27 ships "a new on-device model, rebuilt from the ground up... better at logic and tool calling" whose `model.contextSize` prints `8192`, plus `tokenCount(for:)` and `response.usage` — https://developer.apple.com/videos/play/wwdc2026/241/
4. Escalation target inside the same framework: `PrivateCloudComputeLanguageModel`, "a much bigger model... 32,000 token context window... reasoning", free "to developers who have less than 2 million first time downloads" — https://developer.apple.com/videos/play/wwdc2026/241/
5. Agent primitives: `DynamicProfile` (one active `Profile` of instructions + tools + model), `toolCallingMode(.allowed | .disallowed | .required)`, `historyTransform`, `onResponse`, `transcriptErrorHandlingPolicy(.preserveTranscript)`, system tools (`OCRTool`, `BarcodeReaderTool`, Spotlight search for local RAG), and the open-source `foundation-models-utilities` package with `droppingCompletedToolCalls()`, `rollingWindow(entries: 10)`, `summarizeHistory(entryThreshold: 10, model:)` and a Skills API — https://developer.apple.com/videos/play/wwdc2026/242/ , https://developer.apple.com/videos/play/wwdc2026/241/ , https://github.com/apple/foundation-models-utilities

---

## 2. Prompt and loop shapes, verbatim where available

### 2.1 smolagents `ToolCallingAgent` system prompt (full)

Source: https://raw.githubusercontent.com/huggingface/smolagents/main/src/smolagents/prompts/toolcalling_agent.yaml

```yaml
system_prompt: |-
  You are an expert assistant who can solve any task using tool calls. You will be given a task to solve as best you can.
  To do so, you have been given access to some tools.

  The tool call you write is an action: after the tool is executed, you will get the result of the tool call as an "observation".
  This Action/Observation can repeat N times, you should take several steps when needed.

  You can use the result of the previous action as input for the next action.
  The observation will always be a string: it can represent a file, like "image_1.jpg".
  Then you can use it as input for the next action. You can do it for instance as follows:

  Observation: "image_1.jpg"

  Action:
  {
    "name": "image_transformer",
    "arguments": {"image": "image_1.jpg"}
  }

  To provide the final answer to the task, use an action blob with "name": "final_answer" tool. It is the only way to complete the task, else you will be stuck on a loop. So your final output should look like this:
  Action:
  {
    "name": "final_answer",
    "arguments": {"answer": "insert your final answer here"}
  }

  Here are a few examples using notional tools:
  ---
  Task: "Generate an image of the oldest person in this document."

  Action:
  {
    "name": "document_qa",
    "arguments": {"document": "document.pdf", "question": "Who is the oldest person mentioned?"}
  }
  Observation: "The oldest person in the document is John Doe, a 55 year old lumberjack living in Newfoundland."

  Action:
  {
    "name": "image_generator",
    "arguments": {"prompt": "A portrait of John Doe, a 55-year-old man living in Canada."}
  }
  Observation: "image.png"

  Action:
  {
    "name": "final_answer",
    "arguments": "image.png"
  }

  ---
  Task: "What is the result of the following operation: 5 + 3 + 1294.678?"

  Action:
  {
      "name": "python_interpreter",
      "arguments": {"code": "5 + 3 + 1294.678"}
  }
  Observation: 1302.678

  Action:
  {
    "name": "final_answer",
    "arguments": "1302.678"
  }

  ---
  Task: "Which city has the highest population , Guangzhou or Shanghai?"

  Action:
  {
      "name": "web_search",
      "arguments": "Population Guangzhou"
  }
  Observation: ['Guangzhou has a population of 15 million inhabitants as of 2021.']


  Action:
  {
      "name": "web_search",
      "arguments": "Population Shanghai"
  }
  Observation: '26 million (2019)'

  Action:
  {
    "name": "final_answer",
    "arguments": "Shanghai"
  }

  Above example were using notional tools that might not exist for you. You only have access to these tools:
  {%- for tool in tools.values() %}
  - {{ tool.to_tool_calling_prompt() }}
  {%- endfor %}

  {%- if managed_agents and managed_agents.values() | list %}
  You can also give tasks to team members.
  Calling a team member works similarly to calling a tool: provide the task description as the 'task' argument. Since this team member is a real human, be as detailed and verbose as necessary in your task description.
  You can also include any relevant variables or context using the 'additional_args' argument.
  Here is a list of the team members that you can call:
  {%- for agent in managed_agents.values() %}
  - {{ agent.name }}: {{ agent.description }}
    - Takes inputs: {{agent.inputs}}
    - Returns an output of type: {{agent.output_type}}
  {%- endfor %}
  {%- endif %}

  {%- if custom_instructions %}
  {{custom_instructions}}
  {%- endif %}

  Here are the rules you should always follow to solve your task:
  1. ALWAYS provide a tool call, else you will fail.
  2. Always use the right arguments for the tools. Never use variable names as the action arguments, use the value instead.
  3. Call a tool only when needed: do not call the search agent if you do not need information, try to solve the task yourself. If no tool call is needed, use final_answer tool to return your answer.
  4. Never re-do a tool call that you previously did with the exact same parameters.

  Now Begin!
```

Fallback when the loop gives up (same file):

```yaml
final_answer:
  pre_messages: |-
    An agent tried to answer a user query but it got stuck and failed to do so. You are tasked with providing an answer instead. Here is the agent's memory:
  post_messages: |-
    Based on the above, please provide an answer to the following user task:
    {{task}}
```

### 2.2 smolagents planning step (structure; headings as in file, prose paraphrased by fetch)

Source: https://raw.githubusercontent.com/huggingface/smolagents/main/src/smolagents/prompts/code_agent.yaml ; trigger logic: https://raw.githubusercontent.com/huggingface/smolagents/main/src/smolagents/agents.py

Runs when `planning_interval is not None` and `(step_number == 1) or ((step_number - 1) % planning_interval == 0)`, with stop sequence `<end_plan>`. Initial plan asks for:

```
1. Facts survey
  1.1. Facts given in the task
  1.2. Facts to look up
  1.3. Facts to derive
2. Plan   (high-level steps, "do not detail individual tool calls", end with <end_plan>)
```

Update plan (later steps, memory rendered in `summary_mode=True`, template also receives `remaining_steps`):

```
1. Updated facts survey
  1.1. Facts given in the task
  1.2. Facts that we have learned
  1.3. Facts still to look up
  1.4. Facts still to derive
2. Plan
```

The docs describe it as: "the LLM is simply asked to update a list of facts it knows and to reflect on what steps it should take next based on those facts" — https://huggingface.co/docs/smolagents/tutorials/building_good_agents

### 2.3 smolagents error feedback strings (verbatim) and structured mode

Source: https://raw.githubusercontent.com/huggingface/smolagents/main/src/smolagents/agents.py

```
"Error in code parsing:\n{e}\nMake sure to provide correct code blobs."
"Error in generating model output:\n{e}"
"Error while parsing tool call from model output: {e}"
"Unknown tool {tool_name}, should be one of: {available_tools}"
"Error executing tool '{tool_name}' with arguments {arguments}: {type(e).__name__}: {e}\nPlease try again or use another tool"
"If you want to return an answer, please do not perform any other tool calls than the final answer tool call!"
"You returned multiple final answers. Please return only one single final answer!"
"Reached max steps."
"Check {check_function.__name__} failed with error: {e}"
```

Stop sequences on the action call: `["Observation:", "Calling tools:"]`. Native tool calls are used when `chat_message.tool_calls` is non-empty, else `model.parse_tool_calls(chat_message)` extracts a JSON blob by key (`tool_name_key`, `tool_arguments_key`) via `parse_json_blob` — no `Action:` regex.

`use_structured_outputs_internally=True` swaps to `structured_code_agent.yaml` and passes this schema — https://raw.githubusercontent.com/huggingface/smolagents/main/src/smolagents/models.py :

```python
CODEAGENT_RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "schema": {
            "additionalProperties": False,
            "properties": {
                "thought": {"description": "A free form text description of the thought process.", "title": "Thought", "type": "string"},
                "code": {"description": "Valid Python code snippet implementing the thought.", "title": "Code", "type": "string"},
            },
            "required": ["thought", "code"],
            "title": "ThoughtAndCodeAnswer",
            "type": "object",
        },
        "name": "ThoughtAndCodeAnswer",
        "strict": True,
    },
}
```

### 2.4 react-native-executorch tool schema and parser (verbatim)

Tool definition shape — https://docs.swmansion.com/react-native-executorch/docs/hooks/natural-language-processing/useLLM :

```javascript
{
  name: 'get_weather',
  description: 'Get/check weather in given location.',
  parameters: {
    type: 'dict',
    properties: {
      location: { type: 'string', description: 'Location where user wants to check weather' },
    },
    required: ['location'],
  },
}
```

Parser — https://raw.githubusercontent.com/software-mansion/react-native-executorch/main/packages/react-native-executorch/src/utils/llm.ts :

```typescript
export const parseToolCall: (message: string) => ToolCall[] = (message: string) => {
  const unparsedToolCalls = message.match("\\[(.|\\s)*\\]");
  if (!unparsedToolCalls) {
    return [];
  }

  let parsedMessage: LLMTool[];
  try {
    parsedMessage = JSON.parse(unparsedToolCalls[0]);
  } catch (e) {
    throw new RnExecutorchError(
      RnExecutorchErrorCode.InvalidModelOutput,
      `Failed to parse tool call JSON from model output: ${unparsedToolCalls[0]}`,
      e,
    );
  }

  const results: ToolCall[] = [];
  for (const tool of parsedMessage) {
    if (
      "name" in tool &&
      typeof tool.name === "string" &&
      "arguments" in tool &&
      tool.arguments !== null &&
      typeof tool.arguments === "object"
    ) {
      results.push({ toolName: tool.name, arguments: tool.arguments });
    }
  }
  return results;
};
```

Loop in `LLMController` _(paraphrased by fetch)_: `parseToolCall(response)` → for each call `executeToolCallback(toolCall)` → append `{ content: toolResponse, role: 'assistant' }` → `contextStrategy.buildContext(systemPrompt, history, maxContextLength, countTokensCallback)` — https://raw.githubusercontent.com/software-mansion/react-native-executorch/main/packages/react-native-executorch/src/controllers/LLMController.ts

### 2.5 Apple Foundation Models agent primitives (verbatim from session code)

Source: https://developer.apple.com/videos/play/wwdc2026/242/

Tool-calling mode as a bounded loop:

```swift
.toolCallingMode(.required)
// Exit condition example:
.toolCallingMode(state.queriedDatabase ? .disallowed : .required)
.onToolCall { state.queriedDatabase = true }
```

Per-request history transform (keep only tool I/O before the last response):

```swift
.historyTransform { history in
    guard let latestResponseIndex = lastResponseEntryIndex(history) else { return history }
    let filteredHistory = history[0..<latestResponseIndex].filter { entry in
        isToolCallsOrToolOutput(entry)
    }
    return filteredHistory + history[latestResponseIndex...]
}
```

Summarize at a threshold:

```swift
.onResponse {
    if history.count > 50, let responseIndex = lastResponseIndex(history) {
        summary = try await summarize(history[0..<responseIndex])
        history = history[responseIndex...]
    }
}
```

"Phone-a-friend" — a tool that runs a child session with an isolated transcript:

```swift
struct PhoneFriendTool<P: LanguageModelSession.DynamicProfile>: Tool {
    func call(arguments: GeneratedContent) async throws -> String {
        let session = LanguageModelSession(profile: profile())
        let response = try await session.respond(to: arguments)
        return response.content
    }
}
```

Errors: "By default, errors revert the transcript"; `.transcriptErrorHandlingPolicy(.preserveTranscript)` keeps it. "KV Cache: Appending preserves cache; rewriting invalidates it and increases latency." "Data driven optimization is the only way to be confident."

WWDC25 overflow recovery — https://developer.apple.com/videos/play/wwdc2025/301/ :

```swift
} catch LanguageModelSession.GenerationError.exceededContextWindowSize {
  // Handle error
}

private func newSession(previousSession: LanguageModelSession) -> LanguageModelSession {
  let allEntries = previousSession.transcript.entries
  var condensedEntries = [Transcript.Entry]()
  if let firstEntry = allEntries.first {
    condensedEntries.append(firstEntry)                 // instructions
    if allEntries.count > 1, let lastEntry = allEntries.last {
      condensedEntries.append(lastEntry)                // last response
    }
  }
  return LanguageModelSession(transcript: Transcript(entries: condensedEntries))
}
```

Same session on tools: tools "are invoked in parallel" when the model emits several in one request; description should be "~1 sentence (longer strings = more tokens = higher latency)"; arguments are `@Generable` so input is schema-valid by constrained decoding.

### 2.6 PocketPal loop (prose, verbatim)

"the `AgentRunner` detects a call, runs the engine, and returns the result for the next turn" — orchestrating "streaming tokens, dispatching **Talents** (tools) when the model calls them, and feeding results back for follow-up reasoning." — https://github.com/a-ghorbani/pocketpal-ai

### 2.7 Gemini Nano hand-rolled loop (third-party, verbatim snippet)

Source: https://mvpfactory.io/blog/gemini-nano-on-device-function-calling-for-android-structured-output-token/

```kotlin
fun parseAgentAction(raw: String): AgentAction? {
    val json = JsonExtractor.findFirst(raw) ?: return null
    val parsed = toolRegistry.parse(json)
    return parsed?.takeIf { action -> semanticValidator.isReasonable(action) }
}
```

Three layers: JSON extraction from markdown-wrapped output, schema validation against the registry, semantic bounds ("duration_min in 1..480, title.length < 200"); "Layer 1 alone catches roughly half of all failures." — https://dev.to/software_mvp-factory/gemini-nano-on-device-function-calling-for-android-18o3

---

## 3. Numbers

| Item                                              | Value                                                                                                         | Source                                                                                                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apple on-device model size                        | ~3B params, 2 bits/weight (QAT); embeddings 4 bpw; KV cache 8 bpw                                             | https://machinelearning.apple.com/research/apple-foundation-models-2025-updates                                                                                                   |
| Apple on-device context (iOS 26)                  | 4096 tokens; image ≈ 200 tokens                                                                               | https://kruschel.dev/notes/wwdc26-group-labs/wwdc2026-8011                                                                                                                        |
| Apple on-device context (iOS 27 model)            | `model.contextSize` → `8192`                                                                                  | https://developer.apple.com/videos/play/wwdc2026/241/                                                                                                                             |
| Apple PCC model                                   | 32,000-token context, reasoning levels, free under 2M first-time downloads                                    | https://developer.apple.com/videos/play/wwdc2026/241/                                                                                                                             |
| Apple training sequence length                    | up to 65K tokens (training, not the API limit)                                                                | https://machinelearning.apple.com/research/apple-foundation-models-2025-updates                                                                                                   |
| Apple adapters                                    | rank 32 via Python toolkit; retrain per base-model version                                                    | https://machinelearning.apple.com/research/apple-foundation-models-2025-updates                                                                                                   |
| Apple utilities defaults                          | `rollingWindow(entries: 10)`, `summarizeHistory(entryThreshold: 10)`                                          | https://github.com/apple/foundation-models-utilities                                                                                                                              |
| Apple session-242 summarize trigger               | `history.count > 50`                                                                                          | https://developer.apple.com/videos/play/wwdc2026/242/                                                                                                                             |
| On-device vs cloud latency (summarize 621 tokens) | on-device 3.77 s vs Gemini Flash 1.52 s                                                                       | https://peterfriese.dev/blog/2026/hybrid-ai-apple-foundation-models-gemini                                                                                                        |
| Gemini Nano Prompt API input                      | "under 4000 tokens, approximately 3000 English words"; avoid >4K output                                       | https://developers.google.com/ml-kit/genai/prompt/android/get-started                                                                                                             |
| Gemini Nano Prompt API status                     | beta; `1.0.0-beta3` (Jul 2026); schema compiler `1.0.0-alpha1`                                                | https://developers.google.com/ml-kit/genai/prompt/android , https://android-developers.googleblog.com/2026/07/android-on-device-inference.html                                    |
| Gemini Nano reach                                 | "over 140 million devices"                                                                                    | https://developers.googleblog.com/adk-kotlin-android-building-ai-agents/                                                                                                          |
| Nano context (third-party claim)                  | "roughly 32K tokens"; 5 tools ≈ 800–1,200 tokens of schema; cap 1,200                                         | https://mvpfactory.io/blog/gemini-nano-on-device-function-calling-for-android-structured-output-token/                                                                            |
| smolagents defaults                               | `max_steps=20`, `planning_interval=None`, `tool_choice="required"`, `use_structured_outputs_internally=False` | https://huggingface.co/docs/smolagents/reference/agents , https://raw.githubusercontent.com/huggingface/smolagents/main/src/smolagents/models.py                                  |
| smolagents size / claims                          | core "~1,000 lines"; "30% fewer steps" for code actions                                                       | https://raw.githubusercontent.com/huggingface/smolagents/main/README.md                                                                                                           |
| CodeAct paper                                     | "up to 20% higher success rate" vs JSON/text actions, 17 LLMs                                                 | https://arxiv.org/abs/2402.01030                                                                                                                                                  |
| executorch models                                 | 135M–4B; tool-calling model Hammer 2.1 1.5B                                                                   | https://docs.swmansion.com/react-native-executorch/docs/hooks/natural-language-processing/useLLM , https://swmansion.com/blog/react-native-executorch-release-v0-4-0-262d4013ac10 |
| executorch context default                        | `SlidingWindowContextStrategy` by tokens (example `maxTokens: 2048`)                                          | https://docs.swmansion.com/react-native-executorch/docs/hooks/natural-language-processing/useLLM                                                                                  |
| Private Mind                                      | model downloads 1–3 GB; iOS 17+; RAG on `all_minilm_l6_v2`                                                    | https://apps.apple.com/us/app/private-mind/id6746713439 , https://github.com/software-mansion-labs/private-mind , https://github.com/software-mansion-labs/react-native-rag       |
| MLC example config                                | `context_window_size` 4096, `prefill_chunk_size` 4096                                                         | https://llm.mlc.ai/docs/deploy/mlc_chat_config.html                                                                                                                               |
| react-native-ai (Vercel AI SDK on Apple)          | Apple provider lists text generation, embeddings (512-d), transcription, TTS; SDK v6 from 0.12                | https://github.com/callstackincubator/ai                                                                                                                                          |

---

## 4. What Goliath should change

Each item: the change, why, how to test, source.

1. **Derive the budget from `contextSize` at runtime; never hardcode 4,096.** The iOS 27 model reports `8192`; iOS 26 devices stay at 4,096; Nano's Prompt API is "under 4000" input. Test: a `Budget` built from a stubbed model reporting 4096 and one reporting 8192 yields different scribe/step-log caps; a snapshot test of the conductor prompt token count via `tokenCount(for:)` (or a heuristic on Android) stays under 40% of `contextSize` with ten registered tools. Sources: https://developer.apple.com/videos/play/wwdc2026/241/ , https://developers.google.com/ml-kit/genai/prompt/android/get-started

2. **Put the no-repeat rule in the conductor prompt, not only in the escalation trap.** smolagents rule 4: "Never re-do a tool call that you previously did with the exact same parameters." Goliath detects repeats after the fact; a one-line rule plus the step log's `tool(args) → result` lines lets the model avoid it. Test: eval set where step 1 already fetched the value; measure repeated-call escalations before/after. Source: https://raw.githubusercontent.com/huggingface/smolagents/main/src/smolagents/prompts/toolcalling_agent.yaml

3. **Add a `Facts` slot to the scribe brief.** smolagents' planning step is a facts survey (given / learned / still to look up / still to derive); Goliath's Goal/Done/Decisions/Pending/Next records _events_, not _values_, so a value fetched in step 1 can be lost by step 3 once results compress. Keep it to `key: value` lines under a word cap. Test: a three-step task where step 3's arguments must equal a value only present in step 1's result; the worker's structured output matches without a re-fetch. Sources: https://raw.githubusercontent.com/huggingface/smolagents/main/src/smolagents/prompts/code_agent.yaml , https://huggingface.co/docs/smolagents/tutorials/building_good_agents

4. **Feed tool failures back once before escalating, in smolagents' shape.** `Error executing tool '{tool_name}' with arguments {arguments}: {type}: {e}\nPlease try again or use another tool` — a one-line observation with the tool, args, and error, then one more plan. Today a tool error is indistinguishable from a model error in the escalation policy. Test: a tool that throws once then succeeds finishes on-device without escalation; a tool that throws twice escalates with both errors in the step log. Source: https://raw.githubusercontent.com/huggingface/smolagents/main/src/smolagents/agents.py

5. **Add an on-device "best-effort answer" path when cloud fallback is unavailable.** smolagents never returns nothing: on max steps it runs `provide_final_answer` with "An agent tried to answer a user query but it got stuck and failed to do so. You are tasked with providing an answer instead." and returns state `max_steps_error`. Goliath's escalate-to-cloud assumes a network. Test: with the cloud provider disabled, a stuck run returns `{kind: "answer", state: "best_effort"}` synthesized from the brief plus step log, not an exception. Sources: https://raw.githubusercontent.com/huggingface/smolagents/main/src/smolagents/prompts/toolcalling_agent.yaml , https://raw.githubusercontent.com/huggingface/smolagents/main/src/smolagents/agents.py

6. **Make the compression policy a named, testable transform with thresholds.** Apple ships `droppingCompletedToolCalls()`, `rollingWindow(entries: 10)`, `summarizeHistory(entryThreshold: 10, model:)`, and session 242's `.historyTransform` (keep only tool I/O before the last response) and `.onResponse` at `history.count > 50`. Goliath's "results compress to `key: value` lines" should be one pure function `compress(stepLog, budget)` with stated thresholds (e.g. drop completed tool I/O older than N steps once Facts captured them). Test: property test that `compress` output is always under budget and never drops a value referenced in `Facts` or `Pending`. Sources: https://github.com/apple/foundation-models-utilities , https://developer.apple.com/videos/play/wwdc2026/242/

7. **Catch context overflow and rebuild from instructions + brief, per Apple's own recipe.** WWDC25: catch `exceededContextWindowSize`, start a new session carrying "the instructions (first entry)" and the last response. Goliath's scribe brief is the better "last response". Test: a fake model that throws overflow at step k; the run continues in a fresh session whose transcript is exactly `[instructions, brief]` and the step log records the rebuild. Source: https://developer.apple.com/videos/play/wwdc2025/301/

8. **Split "no plan JSON" from "bad plan JSON" and treat them differently.** executorch returns `[]` when no bracketed block exists and throws `InvalidModelOutput` only when a block exists but does not parse; smolagents distinguishes `Error while parsing tool call from model output` from `Unknown tool {tool_name}, should be one of: {available_tools}`. Goliath's single "malformed plan → one hinted retry" should send three different hints: empty output (nudge to emit the schema), parse failure (hint the exact schema), unknown tool (list the valid names). Test: three fixtures, three distinct retry prompts, each retry succeeding on a second stubbed response. Sources: https://raw.githubusercontent.com/software-mansion/react-native-executorch/main/packages/react-native-executorch/src/utils/llm.ts , https://raw.githubusercontent.com/huggingface/smolagents/main/src/smolagents/agents.py

9. **Publish tool-authoring rules: one-sentence description, compound tools, errors that teach.** Apple: description "~1 sentence (longer strings = more tokens = higher latency)". smolagents: "group 2 tools in one", "Reduce the number of LLM calls as much as you can", and tool errors should say what to fix ("make sure to provide a string in format '%m/%d/%y %H:%M:%S'"). Nano guidance: 5 tools ≈ 800–1,200 tokens of schema. Test: a registry lint that rejects descriptions over N words and argument schemas over M tokens; an eval that counts steps per task and fails on regression. Sources: https://developer.apple.com/videos/play/wwdc2025/301/ , https://huggingface.co/docs/smolagents/tutorials/building_good_agents , https://mvpfactory.io/blog/gemini-nano-on-device-function-calling-for-android-structured-output-token/

10. **Try `why` before `kind` in the plan schema.** smolagents' structured mode orders `thought` before `code` in a strict schema ("A free form text description of the thought process" then the action). Goliath's `{kind, tool, brief}` asks the model to commit to `kind` first. Hypothesis, not a finding: a short bounded `why` field first improves tool choice on a 3B model. Test: A/B the two schemas on the same eval set; keep only if plan accuracy rises without exceeding the step-token budget. Source: https://raw.githubusercontent.com/huggingface/smolagents/main/src/smolagents/models.py

11. **Bound the worker with `.required`-then-`.disallowed` semantics, and never let a worker call a tool.** Apple's `toolCallingMode` pattern is `.required` until an exit condition flips it to `.disallowed`. Goliath already isolates the worker to _arguments as structured output_; make that a hard invariant on both platforms (Apple: no tools attached to the worker session; Android: `@Generable` argument class via the Prompt API structured output). Test: a worker session constructed with a non-empty tool list fails a unit assertion; the Android worker uses `STRUCTURE_VALUES_INVALID` / `PARSE_CLASS_ERROR` finish reasons as the malformed-plan signal. Sources: https://developer.apple.com/videos/play/wwdc2026/242/ , https://developers.google.com/ml-kit/genai/prompt/android/structured-output

12. **Prefer Private Cloud Compute as the escalation target on Apple.** Same framework, 32K context, reasoning, no keys, free under 2M downloads, and the step log can be carried as a transcript across profiles (baton-pass). Keep the third-party cloud as the fallback for Android and over-quota. Test: on a device with PCC available, `escalate` selects `PrivateCloudComputeLanguageModel` and passes the step log; on quota exhaustion the run falls through to the configured cloud provider. Sources: https://developer.apple.com/videos/play/wwdc2026/241/ , https://developer.apple.com/videos/play/wwdc2026/242/ , https://kruschel.dev/notes/wwdc26-group-labs/wwdc2026-8011

13. **Model write tools as draft + commit pairs, matching Apple's confirmation contract.** Session 240: Xcode refuses `sendMessage` without `draftMessage` because "some Siri scenarios require more than one schema... especially when confirmation is required"; session 343 adds `OwnershipProvidingEntity` for when Siri should confirm. Goliath's "writes confirm first" becomes structural: a write tool declares a `draft` that returns the proposed change as `key: value` lines and a `commit` that takes the draft id. Test: registry rejects a `write` tool without a `draft`; a run shows the draft lines to the user before any commit. Sources: https://developer.apple.com/videos/play/wwdc2026/240/ , https://developer.apple.com/videos/play/wwdc2026/343/

14. **Surface the budget to the user the way PocketPal does.** v1.16.0: "Warn when a chat is near or at the context limit, with recovery". Goliath should expose `budget.remaining` on each step event so the host app can show it and the scribe can tighten early. Test: step events carry `tokensUsed`/`tokensRemaining`; a near-limit event fires before the overflow path in item 7. Source: https://github.com/a-ghorbani/pocketpal-ai/releases

15. **Port the Android worker onto ML Kit structured output, not function calling.** The only official on-device primitives are text and `@Generable` structured output; ADK's on-device path is `GenaiPrompt` with the cloud as orchestrator. Goliath's conductor/worker split maps cleanly: conductor and worker are both structured-output calls. Test: the same `Plan` and per-tool argument schemas generate both a Swift `@Generable` and a Kotlin `@Generable` class from one definition, and a contract test runs the conductor against both. Sources: https://developers.google.com/ml-kit/genai/prompt/android/structured-output , https://developer.android.com/ai/adk

---

## 5. What does not transfer, and why

1. **CodeAgent / CodeAct.** Writing actions as Python needs an interpreter and a sandbox ("warnings against LocalPythonExecutor for untrusted code"); there is none on iOS, and the measured gains ("up to 20% higher success rate", "30% fewer steps") come from server-class models with room to hold code and its output, not a 3B model in 4–8K tokens with guided JSON. Goliath's one-tool worker with constrained decoding is the right primitive here; smolagents itself says JSON `ToolCallingAgent` is for "reliable atomic calls". Sources: https://raw.githubusercontent.com/huggingface/smolagents/main/README.md , https://arxiv.org/abs/2402.01030 , https://huggingface.co/docs/smolagents/reference/agents

2. **smolagents' memory model and step budget.** `write_memory_to_messages` replays every past action and observation; `max_steps=20`; parallel tool calls via `max_tool_threads`. With one request in flight and a few thousand tokens, full replay is impossible and 20 steps of raw observations would overflow by step 4. Goliath's scribe + compression is the substitute; only the _shape_ of planning (facts survey) and error strings transfer. Sources: https://huggingface.co/docs/smolagents/reference/agents , https://raw.githubusercontent.com/huggingface/smolagents/main/src/smolagents/agents.py

3. **Apple's parallel tool calls and `.allowed` mode.** The on-device model can emit several tool calls per request and "tools are invoked in parallel"; Goliath deliberately runs one tool per step, and a mode where the model may or may not call a tool is exactly the ambiguity the conductor/worker split removes. Do not re-introduce free tool choice at the worker. Source: https://developer.apple.com/videos/play/wwdc2025/301/

4. **Dynamic Profiles, `historyTransform`, `onResponse`, Skills — as APIs.** They are Swift `LanguageModelSession` modifiers. Through the Vercel AI SDK on React Native the Apple provider documents text generation, embeddings, transcription and TTS; tool calling is announced by callstack but not documented on the provider README, and none of the transcript modifiers are exposed. Goliath must keep owning its loop in TypeScript; borrow the _policies_ (item 6), not the APIs. Sources: https://github.com/callstackincubator/ai , https://developer.apple.com/videos/play/wwdc2026/242/ , https://www.callstack.com/blog/expanding-on-device-apple-llm-capabilities-introducing-tool-calling (fetch returned 403; title only)

5. **Siri's system orchestrator and App Toolbox.** They are Siri calling _into_ apps via App Intents schemas; nothing in sessions 102, 240, 343 or the newsroom post gives a third-party app an API to invoke the orchestrator, enumerate the toolbox, or call another app's intents. App Intents are how Goliath's host app becomes a tool _for Siri_, not a tool source _for Goliath_. Reports of native MCP support are conditional speculation ("If Apple ships native MCP support"). Sources: https://developer.apple.com/videos/play/wwdc2026/102/ , https://developer.apple.com/videos/play/wwdc2026/240/ , https://developer.apple.com/videos/play/wwdc2026/343/ , https://www.mindstudio.ai/blog/apple-wwdc-ai-strategy-siri-app-intents-mcp

6. **Private Mind.** It has no agentic surface; the transferable lesson is one line ("Move context to message instead of attaching it in system prompt") and the RAM-based model pick. Its RAG stack (MiniLM + op-sqlite) would be a tool for Goliath, not a harness. Sources: https://github.com/software-mansion-labs/private-mind/releases , https://github.com/software-mansion-labs/react-native-rag

7. **react-native-executorch's managed tool loop.** It depends on a chat template that emits a bare JSON array (Hammer 2.1), appends tool output as `assistant`, has no step cap and no repeat detection, and the parser silently drops malformed entries. Goliath's loop is already stricter; only the parse-state distinction (item 8) is worth copying. Apple's model exposes no chat template, so the executorch path is not an Apple path at all. Sources: https://raw.githubusercontent.com/software-mansion/react-native-executorch/main/packages/react-native-executorch/src/controllers/LLMController.ts , https://raw.githubusercontent.com/software-mansion/react-native-executorch/main/packages/react-native-executorch/src/utils/llm.ts

8. **PocketPal Talents.** Native llama.cpp tool calling on models chosen for it (Qwen, Gemma, Phi), BYOK web search, GGUF downloads of 1–3 GB. The `TalentRegistry`/`AgentRunner` split mirrors Goliath's registry + runner, but the model-side contract (chat-template tool calls, free-form follow-up reasoning) is not available on Apple's model. Source: https://github.com/a-ghorbani/pocketpal-ai

9. **Gemini Nano "function calling" and "32K".** Only third-party posts claim them; Google's Prompt API pages (beta3, July 2026) document text + structured output and an input limit "under 4000 tokens". Build the Android path on what is documented (item 15) and revisit if Google publishes a function-calling API. Sources: https://developers.google.com/ml-kit/genai/prompt/android/get-started , https://android-developers.googleblog.com/2026/07/android-on-device-inference.html , https://mvpfactory.io/blog/gemini-nano-on-device-function-calling-for-android-structured-output-token/

10. **ADK's hybrid pattern in reverse.** Google puts the _cloud_ model as orchestrator and Nano as a privacy sub-agent; Apple's session-242 example likewise puts brainstorming on PCC and "lightweight" review on-device. Goliath inverts this (on-device conductor, cloud only on escalation). That is a product choice, not a mistake — but it means Goliath cannot borrow their orchestrator prompts, which assume a large-context planner. Sources: https://developers.googleblog.com/adk-kotlin-android-building-ai-agents/ , https://developer.apple.com/videos/play/wwdc2026/242/

11. **LLMFarm, Enchanted, MLC Chat.** No agent loop; MLC's `use_function_calling` is a format check flag, not a harness. Nothing to transfer. Sources: https://github.com/guinmoon/LLMFarm , https://github.com/gluonfield/enchanted , https://llm.mlc.ai/docs/deploy/mlc_chat_config.html

---

### Fetch notes

- Apple technote TN3193 and "Managing the context window" returned title-only pages; the 4096 figure is from the WWDC26 group-lab notes and the peterfriese post, the 8192 figure from session 241's on-screen code.
- callstack's two blog posts returned HTTP 403; only their titles (from search) are cited.
- Release dates rendered by the GitHub release pages were inconsistent and are omitted; version numbers are as shown.
