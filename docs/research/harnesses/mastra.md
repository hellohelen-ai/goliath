# Mastra — harness research brief for Goliath

Researched 2026-09-02 from DeepWiki (`deepwiki.com/mastra-ai/mastra`), the mastra.ai docs, and the
`mastra-ai/mastra` source on GitHub (`main`). Every claim carries the URL it came from. Where a
WebFetch summary paraphrased source, the paraphrase is marked as such; quoted strings are verbatim.

Goliath's frame, for reading this: Apple's ~3B on-device Foundation Model, 4,096-token window, one
request in flight, guided JSON output, no logprobs, driven from React Native via the Vercel AI SDK.
Conductor plans one flat JSON step at a time; each worker gets a fresh context and one tool and
returns only the arguments; Goliath runs the tool; results compress to `key: value` lines; writes
confirm first; repeats/empties/malformed plans/model errors escalate to a cloud fallback with the
step log; a scribe keeps a 60-word rolling brief (Goal/Done/Decisions/Next).

---

## 1. What it is, in 5 lines

1. A TypeScript framework "for building production AI applications": an agent execution engine (LLM
   integration, tool calling, memory) plus a workflow engine (multi-step processes with state and
   durability), covering "94 providers and 3,373+ models" through one model-router string
   (`provider/model`). — https://deepwiki.com/mastra-ai/mastra, https://mastra.ai/docs/agents/overview
2. An `Agent` is `{ id, name, instructions, model, tools?, memory?, agents?, inputProcessors?, outputProcessors?, scorers? }`; `generate()` consumes the same stream `stream()` exposes. — https://deepwiki.com/mastra-ai/mastra/3.1-agent-configuration-and-execution
3. Memory is a stack of _processors_ (message history, working memory, semantic recall, observational memory) that prepend context on input and persist on output. — https://mastra.ai/docs/memory/memory-processors
4. Workflows (`createWorkflow`/`createStep`) are typed DAGs with `.then/.parallel/.branch/.dountil/.foreach`, snapshot-persisted `suspend()`/`resume()`, and step retries. — https://deepwiki.com/mastra-ai/mastra/4-workflow-system
5. Evals are `createScorer` pipelines (preprocess → analyze → generateScore → generateReason) attached to agents with sampling, or run over datasets with `runExperiment`. — https://mastra.ai/docs/scorers/overview, https://deepwiki.com/mastra-ai/mastra/11.3-evaluation-system-and-scorers

Positioning rule from the docs: "Use agents when the task is open-ended and the steps aren't known in advance"; workflows are for predetermined multi-step processes with explicit control flow. — https://mastra.ai/docs/agents/overview

---

## 2. The main loop

**Pipeline.** `generate()`/`stream()` run a four-step _prepare-stream_ workflow, then the agentic loop:
`prepare-tools-step` (resolve dynamic tools, add built-ins, convert to `CoreTool`) → `prepare-memory-step`
(load thread history, init `MessageList`, run input processors) → `map-results-step` (consolidate into
`ModelLoopStreamArgs`; inject `StructuredOutputProcessor` when a schema is given) → `stream-step` (invoke
`MastraLLMVNext`; `SaveQueueManager` persists messages). — https://deepwiki.com/mastra-ai/mastra/3.1-agent-configuration-and-execution

**Turn flow.** The loop is a cyclical "LLM → Tool → LLM" pattern; each iteration is (1) LLM execution
step, (2) tool-call step, (3) iteration control. System messages are reset "to their original state at
the start of every step" (`messageList.get.all.aiV5.model()`). Tool results are appended to the
`messageList` so the next LLM step sees them. — https://deepwiki.com/mastra-ai/mastra/3.8-agentic-execution-loop-(the-loop)

**Step limit.** `maxSteps` default is **5** per `generate()`/`stream()` call. Also: `toolChoice` default
`'auto'`; `activeTools` default `undefined` (all); `toolCallConcurrency` default `1` when approval is
required, otherwise `10`; `savePerStep` default `false`; `requireToolApproval` default `false`. —
https://mastra.ai/reference/agents/generate

**Stop conditions.** The loop exits on: terminal finish reasons `stop`, `error`, `length`,
`content-filter`; `maxSteps` reached; custom `stopWhen` predicate true (the docs mention
`stepCountIs` / `hasFinishedSteps` helpers); "no pending signals or background tasks remain". —
https://deepwiki.com/mastra-ai/mastra/3.8-agentic-execution-loop-(the-loop)

**Zero-output guard (worth copying).** `STEP_CONTENT_CHUNK_TYPES` = `'text-delta', 'reasoning-delta',
'tool-call', 'tool-call-delta', 'tool-result', 'object', 'object-result', 'file', 'source'`. If a step
finishes with reason `'other'` and produced none of those, it is converted into a synthetic error
("Agent stream finished with finishReason 'other' without producing any output") rather than looped,
because otherwise the loop "re-sends the same request and spins until maxSteps". The error is deferred so
`errorProcessors` can retry boundedly. — https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/core/src/loop/workflows/agentic-execution/llm-execution-step.ts (paraphrase of source + quoted comment)

**Streaming.** Output is a `MastraModelOutput` "unified interface for streaming and async results";
chunk types include `text-delta`, `tool-call`, `tool-result`, `reasoning-delta`, `file`, plus
`tool-call-approval`, `tool-call-suspended`, `tripwire`, `object-result`. —
https://deepwiki.com/mastra-ai/mastra/3.8-agentic-execution-loop-(the-loop), https://mastra.ai/docs/agents/human-in-the-loop, https://mastra.ai/docs/agents/processors

**Interrupts / signals.** "At the start of each loop iteration, the engine can drain pending signals to
inject them into the conversation history." Processors can `sendSignal({ type: 'reactive', contents,
transient: true })` to deliver a system reminder that is not retained. —
https://deepwiki.com/mastra-ai/mastra/3.8-agentic-execution-loop-(the-loop), https://mastra.ai/docs/agents/processors

**Suspend/resume in the agent loop.** With `requireToolApproval` (or `requireApproval` on a tool) the
tool-call step "emits a `tool-call-approval` chunk and calls `suspend()`. The run ID and tool call ID
are saved so the run can be resumed once a user provides an approval decision." Approval forces tool
concurrency to sequential. `generate()` returns `finishReason: 'suspended'` with a `suspendPayload`
`{ toolCallId, toolName, args }` and a `runId`. — https://deepwiki.com/mastra-ai/mastra/3.8-agentic-execution-loop-(the-loop), https://mastra.ai/docs/agents/human-in-the-loop

---

## 3. Context management

### Memory processors (ordering, and the three auto-added ones)

- `MessageHistory` "Fetches the last 10 messages from storage and prepends them" on input, persists new
  messages on output; `SemanticRecall` vector-searches past messages and prepends; `WorkingMemory`
  retrieves the state for the thread and prepends it. Configuring `lastMessages: 10` auto-adds the
  processor; adding one manually to `inputProcessors` suppresses the auto-add so you control order. —
  https://mastra.ai/docs/memory/memory-processors
- Order: input = `[Memory processors] → [Your inputProcessors]`; output = `[Your outputProcessors] →
[Memory processors]`, so "if your output guardrail calls `abort()`, the memory processors never run
  and **no messages are saved**." — https://mastra.ai/docs/memory/memory-processors
- `MessageHistory` "filters out system messages and strips `<working_memory>` tags before persistence to
  avoid polluting history with internal state". — https://deepwiki.com/mastra-ai/mastra/7.1-memory-system-architecture
- `MemoryConfig` defaults: `lastMessages: 10`, `semanticRecall: false`, `workingMemory` disabled,
  `observationalMemory: false`, `generateTitle: false`, `readOnly: false`,
  `filterIncompleteToolCalls: true`. — https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/core/src/memory/memory.ts, https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/core/src/memory/types.ts

### TokenLimiter

- `new TokenLimiter(limit | { limit, strategy, countMode, trimMode })`. `strategy: 'truncate'`
  (default) or `'abort'`; `countMode: 'cumulative'` (default) or `'part'`; `trimMode: 'best-fit'` or
  `'contiguous'` (the source says best-fit is default; the reference page says contiguous — treat as
  version drift). `encoding` is deprecated: "Token counts are now estimated using `tokenx`". —
  https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/core/src/processors/processors/token-limiter.ts, https://mastra.ai/reference/processors/token-limiter-processor
- Algorithm: "System messages are always preserved, and the most recent non-system messages are kept
  within the token budget." Messages are walked "in reverse order (newest first)"; contiguous stops at
  the first message that doesn't fit, best-fit keeps scanning for ones that do. Input processing removes
  whole messages; output processing truncates text parts mid-message. Overheads: `TOKENS_PER_MESSAGE =
3.8`, `TOKENS_PER_CONVERSATION = 24`; images 765 tokens flat, other media 258 or `byteLength / 4`.
  Throws a `TripWire` if only system messages remain. — same two URLs
- Output side: only `text-delta` and `object` parts count; reasoning/lifecycle/tool parts pass through;
  on truncate it emits a transient `data-token-limit-reached` part. — https://mastra.ai/reference/processors/token-limiter-processor

### ToolCallFilter

- `new ToolCallFilter({ exclude?: string[], filterAfterToolSteps?: number, preserveModelOutput?: boolean })`.
  No args = drop all tool calls/results from what the model sees. It runs in `processLLMRequest`, so
  "Changes are transient: they affect only what's sent to the model on that call" — storage, memory, UI
  keep the full record. `filterAfterToolSteps: 0` filters all prior tool calls; `N` keeps the last N
  tool-producing steps. `preserveModelOutput: true` "replaces removed tool data with compact text
  representations so models still see summarized outputs". — https://mastra.ai/reference/processors/tool-call-filter, https://mastra.ai/docs/agents/processors
- `ToolSearchProcessor` adds `search_tools` / `load_tool` meta-tools so large tool libraries aren't in
  the prompt. — https://mastra.ai/docs/agents/processors

### Observational memory (OM) — the long-context mechanism

- Three tiers: recent messages → observations → reflections. Observer fires when unobserved message
  tokens exceed `observation.messageTokens` (default **30,000**); Reflector fires when observation
  tokens exceed `reflection.observationTokens` (default **40,000**). Compression "is typically between
  5x and 40x". Message history "oscillates between ~6k-30k tokens; observation log stays bounded near
  40k regardless of conversation length. Reflection rewrites the entire log rather than accumulating".
  — https://mastra.ai/docs/memory/observational-memory, https://raw.githubusercontent.com/mastra-ai/mastra/main/docs/src/content/en/docs/memory/observational-memory.mdx
- Full defaults (`OBSERVATIONAL_MEMORY_DEFAULTS`): observation `{ model: 'google/gemini-2.5-flash',
messageTokens: 30_000, modelSettings: { temperature: 0.3, maxOutputTokens: 100_000 },
maxTokensPerBatch: 10_000, bufferTokens: 0.2, bufferActivation: 0.8 }`; reflection `{ model:
'google/gemini-2.5-flash', observationTokens: 40_000, modelSettings: { temperature: 0,
maxOutputTokens: 100_000 }, bufferActivation: 0.5 }`. —
  https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/memory/src/processors/observational-memory/constants.ts
- Threshold arithmetic: `bufferTokens` 0–1 is a fraction of `messageTokens` (0.2 × 30k = buffer every
  ~6k tokens), ≥1 is absolute. `bufferActivation` 0–1 = fraction of history removed on activation,
  ≥1000 = absolute tokens to keep; retention floor = `threshold × (1 - ratio)` (so 0.8 keeps ~20%).
  `blockAfter` in `[1, 100)` is a multiplier (default 1.2×), ≥100 absolute; above it activation may
  overshoot to clear backlog. Projected removal never overshoots beyond 95% of the retention floor and
  always keeps ≥1,000 tokens. `shareTokenBudget` lets messages expand into unused observation space:
  `effective = max(totalBudget - currentObservations, baseThreshold)`. —
  https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/memory/src/processors/observational-memory/thresholds.ts, https://mastra.ai/reference/memory/observational-memory
- Buffering: `BufferingCoordinator` pre-computes observations in the background every `bufferTokens`
  so activation is instant; `activateAfterIdle` ("5m", "auto") and `activateOnProviderChange` force
  activation. — https://deepwiki.com/mastra-ai/mastra/7.9-observational-memory-system, https://mastra.ai/reference/memory/observational-memory
- Tool results are shrunk before the Observer reads them: `formatToolResultForObserver(value, { maxTokens })`
  with `DEFAULT_OBSERVER_TOOL_RESULT_MAX_TOKENS = 10_000`, binary-search truncation appending
  `"\n... [truncated ~{tokens_removed} tokens]"`, and `encryptedContent` fields over 256 chars replaced
  by `"[stripped encryptedContent: {length} characters]"`. —
  https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/memory/src/processors/observational-memory/tool-result-helpers.ts
- Client rule: "send **only the new message** from the client instead of the full conversation history".
  — https://mastra.ai/docs/memory/observational-memory, https://mastra.ai/docs/memory/message-history
- OM is **not supported** inside agent networks (`AGENT_NETWORK_OBSERVATIONAL_MEMORY_UNSUPPORTED`). —
  https://deepwiki.com/mastra-ai/mastra/3.7-agent-networks-and-multi-agent-collaboration

### Large outputs / attachments

- Storage record limits (DynamoDB 400 KB, Convex 1 MiB) are handled by an input processor that uploads
  the attachment and swaps in a URL before persistence. — https://mastra.ai/docs/memory/memory-processors
- `webFetchTool` caps page content at 100K characters. — https://mastra.ai/docs/agents/using-tools
- Per-tool `toModelOutput` sends "compressed representations to the model while preserving full results
  in your application". — https://mastra.ai/docs/agents/using-tools

---

## 4. Tools

**Definition.** `createTool({ id, description, inputSchema, outputSchema, execute })`; `execute(inputData,
context)` is the only signature; schemas are Zod, Valibot, or ArkType (Standard JSON Schema). —
https://mastra.ai/docs/agents/overview, https://mastra.ai/docs/agents/using-tools

**Full option surface.** `id`, `description` ("used by the agent to decide when to use the tool"),
`inputSchema`, `outputSchema`, `execute`, `strict` (default `false`), `toModelOutput`, `transform`
(target-aware redaction for display/transcript), `suspendSchema`, `resumeSchema`, `requireApproval`
(default `false`), `mcp.annotations { title, readOnlyHint, destructiveHint, idempotentHint,
openWorldHint }`, `providerOptions`, `inputExamples`, `background`, and hooks `onInputStart`,
`onInputDelta`, `onInputAvailable`, `onOutput`. Context: `{ requestContext, abortSignal, agent, workflow,
mcp, observe }`. — https://mastra.ai/reference/tools/create-tool

**Description style.** Guidance is thin: "concise explanation of primary use case"; "Keeping descriptions
focused on what the tool accomplishes"; and "Mentioning tools in system prompts to guide agent
decisions". The `toolName` the model sees is the object key, not `id`. — https://mastra.ai/docs/agents/using-tools

**Validation.** Six-step input pipeline: `normalizeNullishInput` (top-level null/undefined → `{}` or
`[]`), `convertUndefinedToNull`, first validation, retry after coercing stringified JSON for
object/array fields, strip nullish values on failing paths only, and prompt-alias coercion (`query` /
`message` / `input` → `prompt` when the schema wants `prompt`). On final failure the model receives, verbatim:

```
Tool input validation failed${toolId ? ` for ${toolId}` : ''}. Please fix the following errors and try again:
${errorMessages}

Provided arguments: ${truncateForLogging(input)}
```

with each line `- ${path || 'root'}: ${message}`. — https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/core/src/tools/validation.ts

Validation errors and execution errors alike are "fed back into the model's context, allowing the model to
adjust its tool invocation"; output is checked by `validateToolOutput` and suspend payloads by
`validateToolSuspendData`. — https://deepwiki.com/mastra-ai/mastra/3.3-tool-integration-and-execution, https://deepwiki.com/mastra-ai/mastra/6-tool-system

**Result formatting.** `toModelOutput` transforms what the LLM sees "while the original result is
preserved for the application"; `transform` is for display/transcript targets. JSON repair on the
structured-output path: `escapeUnescapedControlCharsInJsonStrings` and `extractBalancedJsonObject`
(brace-counting extraction of a JSON object from surrounding prose). —
https://deepwiki.com/mastra-ai/mastra/6.1-tool-definition-and-execution-context, https://deepwiki.com/mastra-ai/mastra/3.6-structured-output-and-schema-validation

**Tool count.** No documented cap; the pressure valves are `activeTools` per call and
`ToolSearchProcessor` for "large libraries". — https://mastra.ai/docs/agents/using-tools, https://mastra.ai/docs/agents/processors

**Built-in tools.** `askUserTool` (suspend and ask), `webSearchTool`, `webFetchTool`, `submitPlanTool`,
and task tools `taskWriteTool` / `taskUpdateTool` / `taskCompleteTool` / `taskCheckTool`. —
https://mastra.ai/docs/agents/using-tools

**MCP.** `MCPClient({ servers })` with `listTools()` (static, constructor `tools`) vs `listToolsets()`
(per-request `toolsets` in `generate/stream`); tools are namespaced `serverName_toolName`; `MCPServer`
exposes agents as `ask_<agentKey>` and workflows as `run_<workflowKey>`; elicitation supported. —
https://mastra.ai/docs/mcp/overview, https://deepwiki.com/mastra-ai/mastra/7.8-model-context-protocol-(mcp)-integration

---

## 5. Subagents / agent networks

**Supervisor pattern (current).** Add agents under `agents: { researchAgent }`; the parent gets a
delegation tool per subagent and "decides when and how to assign work based on each subagent's
description". `.network()` is **deprecated**: "Use supervisor agents with `agent.stream()` or
`agent.generate()` instead." — https://mastra.ai/docs/agents/supervisor-agents, https://mastra.ai/docs/agents/networks, https://mastra.ai/reference/agents/network

**Delegation tool schema (from source).** Input: `prompt` ("The prompt to send to the agent"), `threadId`
(nullish, "Thread ID for conversation continuity for memory messages"), `resourceId` (nullish),
`instructions` (nullish, "Additional instructions to append to the agent instructions"), `maxSteps`
(nullish, "Maximum number of execution steps for the sub-agent (integer, minimum 3)"). Output: `text`,
`subAgentThreadId?`, `subAgentResourceId?`, `subAgentToolResults[] { toolName, toolCallId, result, args,
isError }`. — https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/core/src/agent/agent.ts

**Isolation.** Subagents "receive full parent context but only save their delegation prompt and response
to memory". "Each delegation uses a unique thread ID"; the memory docs derive a stable subagent resource
ID as `{parentResourceId}-{agentName}` so a subagent "retains facts across calls". `messageFilter({ messages,
primitiveId, prompt })` overrides what history is forwarded (example: last 10 messages). Under
`.network()`, `filterMessagesForSubAgent()` strips routing JSON (`primitiveId`, `selectionReason`),
completion feedback, and `metadata.mode === 'network'` messages. — https://mastra.ai/docs/agents/supervisor-agents, https://mastra.ai/docs/subagents, https://mastra.ai/docs/memory/overview, https://deepwiki.com/mastra-ai/mastra/3.7-agent-networks-and-multi-agent-collaboration

**Hooks and limits.** `onDelegationStart({ primitiveId, prompt, iteration, requestContext }) → { proceed,
modifiedPrompt?, modifiedMaxSteps?, rejectionReason? }`; `onDelegationComplete({ primitiveId, result:
{ text, usage, finishReason, subAgentToolResults }, error, bail }) → { feedback?, resultText? }`. The
parent's own `maxSteps` bounds the whole thing. Approval requests inside a subagent "propagate up through
the delegation chain and surface at the supervisor level". Background delegation via `backgroundTasks:
{ tools: { researchAgent: { enabled: true, timeoutMs: 900_000 } } }` and `streamUntilIdle()`. —
https://mastra.ai/docs/subagents, https://mastra.ai/docs/agents/human-in-the-loop

**Completion scoring.** `isTaskComplete: { scorers, strategy: 'all' | 'any', onComplete }`: after each
iteration scorers judge the output; a rubric scorer is "LLM-as-judge" and its feedback is appended to
the conversation for another iteration. Under the deprecated network loop, `runDefaultCompletionCheck()`
asks the routing agent for `isComplete: true`. — https://mastra.ai/docs/subagents, https://deepwiki.com/mastra-ai/mastra/3.7-agent-networks-and-multi-agent-collaboration

---

## 6. Memory

### Working memory — the fixed-slot template

Default template (verbatim, from `packages/core/src/memory/memory.ts`):

```
# User Information
- **First Name**:
- **Last Name**:
- **Location**:
- **Occupation**:
- **Interests**:
- **Goals**:
- **Events**:
- **Facts**:
- **Projects**:
```

— https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/core/src/memory/memory.ts

Docs example of a custom template: `'# User Profile\n- Name:\n- Location:\n- Preferences:'`. —
https://mastra.ai/docs/memory/working-memory

Semantics: markdown template = **replace** (the model must return the whole block); JSON schema (Zod /
Valibot / ArkType) = **deep merge** ("objects merge recursively; arrays replace entirely; `null` values
delete properties; primitives overwrite"), implemented by `deepMergeWorkingMemory`. You may configure a
template _or_ a schema, not both. Scope default `resource` (all threads of a user); `thread` isolates.
`readOnly: true` for routers/subagents. Updates go through the `updateWorkingMemory` tool under an
`async-mutex` so parallel calls serialize the read-merge-write. — https://deepwiki.com/mastra-ai/mastra/7.10-working-memory-and-tool-integration, https://raw.githubusercontent.com/mastra-ai/mastra/main/docs/src/content/en/docs/memory/working-memory.mdx

Prompt injection: the processor `messageList.addSystem(instruction, 'memory')`, and the data is shown as

```
<working_memory_template>
[template content]
</working_memory_template>

<working_memory_data>
[current data]
</working_memory_data>
```

The instruction opens `"WORKING_MEMORY_SYSTEM_INSTRUCTION: Store and update any conversation-relevant
information by calling the updateWorkingMemory tool."` and ends with hard lines — standard:
`"IMPORTANT: When calling updateWorkingMemory, the only valid parameter is the memory field."`,
`"IMPORTANT: ALWAYS pass the data you want to store in the memory field as a string."`,
`"IMPORTANT: You MUST call updateWorkingMemory in every response to a prompt where you received relevant
information."`; vnext relaxes to `"If your memory has not changed, you do not need to call the
updateWorkingMemory tool."`, adds `"Information not being relevant to the current conversation is not a
valid reason to remove working memory information."`, and closes `"... if that information is not already
stored."` Read-only variant: `"WORKING_MEMORY_SYSTEM_INSTRUCTION (READ-ONLY): The following is your
working memory - persistent information about the user and conversation..."`. —
https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/core/src/processors/memory/working-memory.ts

Observer-managed variant (`observation.manageWorkingMemory: true`): the Observer, not the chat model,
rewrites working memory, with instructions "Update working memory with durable facts from the
observations you made. Return the full updated Markdown working memory. Preserve useful existing content
and add or revise only what changed." (schema mode: "Return the full updated JSON object ... Return null
when no working memory update is needed."). `retryStructuredExtractionOnEmptyObject: true`; empty results
persist nothing. The docs pitch this as "keeping working memory prompt-cache friendly". —
https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/memory/src/processors/observational-memory/working-memory-extractor.ts, https://mastra.ai/docs/memory/observational-memory

### Observational memory — prompts and data shapes

Observer system prompt (paraphrased structure, quoted fragments): it is "the memory consciousness of an
AI assistant"; observations "become the ONLY information the assistant has about past interactions".
Opening rule: `"CRITICAL: DISTINGUISH USER ASSERTIONS FROM QUESTIONS. When the user TELLS you something
about themselves, mark it as an assertion."` Rules: "🔴 User stated [fact]" vs "🔴 User asked [question]";
"USER ASSERTIONS ARE AUTHORITATIVE"; state changes phrased "User will [new action] (changing from [old
approach])"; two-timestamp temporal anchoring `(TIME) [observation]. (meaning DATE)`; split multiple
events into separate observations; quote unusual phrasing; precise verbs ("subscribed", "purchased",
"canceled" not "got"); group repeated tool calls under one parent with sub-bullets. Output format
constant: `"Use priority levels: 🔴 High, 🟡 Medium, 🟢 Low, ✅ Completed. Group related observations by
indenting."` Guidelines: `"Be specific enough for the assistant to act on. Add 1 to 5 observations per
exchange. Use terse language to save tokens."` Task prompt: `"Extract new observations from the message
history above. Do not repeat observations already in previous observations. Add your new observations in
the format specified."` — https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/memory/src/processors/observational-memory/observer-agent.ts

Observation log shape (docs example):

```
- 🔴 12:10 User is building a Next.js app with Supabase auth, due in 1 week
  - 🔴 12:10 App uses server components with client-side hydration
  - 🟡 12:12 User asked about middleware configuration for protected routes
  - 🔴 12:15 User stated the app name is "Acme Dashboard"
```

and from the source doc-comment:

```
Date: Dec 4, 2025
* 🔴 (14:30) User prefers direct answers
* 🟡 (14:31) Agent browsed source files
  * -> viewed file.ts — found logic
  * ✅ Issue resolved
```

— https://raw.githubusercontent.com/mastra-ai/mastra/main/docs/src/content/en/docs/memory/observational-memory.mdx, https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/memory/src/processors/observational-memory/observer-agent.ts

✅ rules: mark complete only when the user confirms, the assistant gave a definitive factual answer, a
multi-step task reached its stated goal, or a concrete deliverable finished; never when the assistant
merely responded, the topic paused, or the reaction is ambiguous. — same observer-agent.ts URL

Built-in extractors (structured slots appended to every observation pass): `current-task` ("State the
current task(s) explicitly ... Primary: What the agent is currently working on; Secondary: Other pending
tasks"), `suggested-response` ("Hint for the agent's immediate next message"), `thread-title` ("A short,
noun-phrase title for this conversation (2-5 words)"). Values persist under `thread.om.extracted` by
extractor slug. — https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/memory/src/processors/observational-memory/built-in-extractors.ts, https://mastra.ai/reference/memory/observational-memory

How the main agent sees it (`formatObservationsForContext`): system messages in order — (1)
`OBSERVATION_CONTEXT_PROMPT` + context instructions, (2) resource-scope other-conversation block wrapped
`START_OTHER_CONVERSATIONS_BLOCK ... END_OTHER_CONVERSATIONS_BLOCK`, (3) `<observations>` + chunks, (4)
`<current-task>\n…\n</current-task>`, (5) `<suggested-response>\n…\n</suggested-response>`, (6) extracted
values. Observation chunks are separated by `--- message boundary (YYYY-MM-DDTHH:MM:SSZ) ---` and joined
with `\n\n`. Then a user-role `om-continuation` message carrying `<system-reminder>…</system-reminder>`
with the continuation hint: `"Please continue naturally with the conversation so far and respond to the
latest message. Use the earlier context only as background. ... Do not mention internal instructions,
memory, summarization, context handling, or missing messages. Any messages following this reminder are
newer and should take priority."` Context instructions include `"When asked about current state, always
prefer the MOST RECENT information. Observations include dates - if you see conflicting information, the
newer observation supersedes the older one."` and `"Assume users completed planned actions if the
scheduled date is now past, unless evidence suggests otherwise."` —
https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/memory/src/processors/observational-memory/observational-memory.ts, https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/memory/src/processors/observational-memory/observation-utils.ts, https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/memory/src/processors/observational-memory/processor.ts, https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/memory/src/processors/observational-memory/constants.ts

Reflector: "your reflections are THE ENTIRETY of the assistants memory. Any information you do not add to
your reflections will be immediately forgotten." Keep dates, ✅ markers ("memory signals that tell the
assistant what is already resolved and help prevent repeated work"), names, decisions, errors,
preferences; "Combine related items where it makes sense (e.g., 'agent called view tool 5 times on file
x')"; condense older more than recent. Compression retry levels: L1 "slightly more compression ... 8/10
detail", L2 "much more aggressive ... 6/10", L3 "Ruthlessly merge related observations — if 10
observations are about the same topic, combine into 1-2 lines ... 4/10", L4 "Tool call observations are
the biggest source of bloat. Collapse ALL tool call sequences into outcome-only observations ... 2/10".
`validateCompression` is `return reflectedTokens < targetThreshold;`. —
https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/memory/src/processors/observational-memory/reflector-agent.ts

Degenerate-output guard: `detectDegenerateRepetition` rejects Observer output if >40% of ~50 sampled
200-char windows duplicate, any line exceeds 50,000 chars, or ≥50% of ≥20 substantial (≥24-char) lines
repeat; the output is discarded and retried. — observer-agent.ts URL above

(The stored OM record type was not retrievable via raw fetch of `packages/core/src/memory/types.ts`;
DeepWiki describes "observation groups with temporal metadata ... maintaining linkage to original
messages". — https://deepwiki.com/mastra-ai/mastra/7.9-observational-memory-system)

### Semantic recall and scoping

- `semanticRecall: { topK: 4, messageRange: { before: 1, after: 1 }, scope: 'thread' | 'resource',
filter }`, disabled by default, needs a vector store and embedder (OpenAI `text-embedding-3-small`,
  Google `gemini-embedding-001`, or local FastEmbed). — https://mastra.ai/reference/memory/memory-class, https://mastra.ai/docs/memory/semantic-recall
- Scoping: `resourceId` = owner (user), `threadId` = conversation; both required on `generate/stream`.
  "The memory system doesn't enforce access control." — https://mastra.ai/docs/memory/message-history, https://deepwiki.com/mastra-ai/mastra/3.4-agent-memory-system
- OM retrieval: an optional `recall` tool `{ mode: 'messages'|'threads'|'search', query, cursor, threadId,
anchor, page, limit: 20, detail: 'low'|'high', partType, toolName }` for browsing raw messages behind
  observations. — https://mastra.ai/reference/memory/observational-memory
- Budgets: message history 10 messages; OM 30k/40k; `ModelByInputTokens({ upTo: { 10_000: …, 40_000:
…, 1_000_000: … } })` picks the Observer model by input size and throws above the top tier. —
  https://mastra.ai/reference/memory/observational-memory

---

## 7. Permissions and approvals

- **Pre-execution approval.** `requireApproval: true` on a tool, or `requireToolApproval: true` per call,
  pauses _before_ `execute`; the stream emits `tool-call-approval` `{ toolCallId, toolName, args }`;
  continue with `agent.approveToolCall({ runId, toolCallId })` or `declineToolCall({ runId, toolCallId,
reason })` — the `reason` string is what the model sees instead of a generic decline (example reason:
  "Reading other users PII is not allowed, ask the user for their own email instead"). Non-streaming:
  `approveToolCallGenerate`. — https://mastra.ai/docs/agents/human-in-the-loop
- **Mid-execution suspend.** A tool with `suspendSchema` / `resumeSchema` calls
  `context.agent.suspend({ question: '...' })`; the stream emits `tool-call-suspended`; resume with
  `resumeStream(resumeData, { runId })`. `autoResumeSuspendedTools: true` resumes from the user's next
  message (needs memory, same thread, a `resumeSchema`). `listSuspendedRuns({ threadId, resourceId })`
  rediscovers pending runs after restart. — https://mastra.ai/docs/agents/human-in-the-loop
- Cautions from the docs: HITL "uses snapshots to capture state" (configure storage or you get "snapshot
  not found"); "Code after `await suspend(...)` still runs before pausing, so return immediately"; for
  production "bind approval to exact tool name and arguments using stable hashing to prevent argument
  drift before execution". — https://mastra.ai/docs/agents/human-in-the-loop
- MCP annotations `destructiveHint` / `readOnlyHint` "signal UI systems about approval necessity"; with a
  user in `requestContext` an FGA `tools:execute` check runs before execution. —
  https://deepwiki.com/mastra-ai/mastra/6.1-tool-definition-and-execution-context
- **Workflows.** A step with `resumeSchema` does `if (!resumeData?.approved) return await suspend({...})`;
  `run.resume({ step, resumeData })`; `result.status === 'suspended'` lists `result.suspended[]`;
  `suspendData` gives the original payload on resume; `createWorkflowStateReader(state).getSuspendedStep()`
  recovers from storage. `.sleep()` / `.sleepUntil()` are the non-HITL pauses. —
  https://mastra.ai/docs/workflows/suspend-and-resume, https://deepwiki.com/mastra-ai/mastra/4.4-suspend-and-resume-mechanism

---

## 8. Hooks / extensibility

- **Processor interface** (all optional): `processInput` (once, before the loop; may also return system
  messages), `processInputStep` (every step, incl. tool continuations — can switch model/tool choice),
  `processLLMRequest` (rewrite the final prompt; transient), `processLLMResponse`, `processOutputStream`
  (return `null` to drop a chunk), `processOutputStep` (validate each step, may request retry),
  `processOutputResult`, `processAPIError` (4xx/5xx; modify and retry). — https://mastra.ai/docs/agents/processors
- **Abort / tripwire.** `abort(reason, { retry: true })` throws a `TripWire`; streams emit a `tripwire`
  chunk `{ processorId, reason }`, `generate()` sets `result.tripwire` with `finishReason === 'other'`.
  Retries need `maxProcessorRetries` (defaults to 10 when `errorProcessors` exist, otherwise off).
  `onViolation` fires on policy breaches regardless of strategy. Strategies: `block`, `warn`, `detect`,
  `filter`, `redact`, `rewrite`, `translate`. — https://mastra.ai/docs/agents/processors, https://mastra.ai/docs/agents/guardrails, https://deepwiki.com/mastra-ai/mastra/3.5-input-and-output-processors
- Built-ins: `UnicodeNormalizer`, `PromptInjectionDetector`, `LanguageDetector`, `ModerationProcessor`,
  `PIIDetector`, `SystemPromptScrubber`, `BatchPartsProcessor`, `TokenLimiter`, `ToolCallFilter`,
  `ToolSearchProcessor`, `ProviderHistoryCompat`, `ResponseCache` (beta; key from `agentId`,
  `stepNumber`, `scope`, model, prompt). — https://mastra.ai/docs/agents/processors
- Processors can be functions of `requestContext` (per-request), per-call overrides on `generate/stream`,
  or whole workflows (`ProcessorWorkflow`). `ProcessorState` carries `customState` and accumulated text
  across a request. — https://mastra.ai/docs/agents/processors, https://deepwiki.com/mastra-ai/mastra/3.5-input-and-output-processors
- Tool hooks: agent-level `beforeToolCall` / `afterToolCall` (per-execution overrides), plus per-tool
  `onInputStart/onInputDelta/onInputAvailable/onOutput`. — https://mastra.ai/docs/agents/using-tools, https://mastra.ai/reference/tools/create-tool
- Delegation hooks: `onDelegationStart` / `onDelegationComplete` / `messageFilter` (§5). — https://mastra.ai/docs/subagents

---

## 9. Error handling and recovery

- **Model fallbacks.** `model` may be `{ primary, fallbacks[] }` → `ModelManagerModelConfig[]`; failover
  happens at the router. Terminal reasons (`stop`, `error`, `length`, `content-filter`) never retry in
  the loop. — https://deepwiki.com/mastra-ai/mastra/5.5-model-fallbacks-and-error-handling
- **Zero-output steps** become synthetic errors (§2) so `errorProcessors` can retry a bounded number of
  times instead of spinning to `maxSteps`. — https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/core/src/loop/workflows/agentic-execution/llm-execution-step.ts
- **Malformed tool input.** Six-stage coercion, then the exact "Tool input validation failed ..." text
  goes back to the model as the tool result (§4). Execution exceptions are also formatted and returned so
  "The model can then decide to retry, use different parameters, or abandon the tool call". —
  https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/core/src/tools/validation.ts, https://deepwiki.com/mastra-ai/mastra/3.3-tool-integration-and-execution
- **Malformed structured output.** `errorStrategy: 'strict' | 'warn' | 'fallback'` with `fallbackValue`;
  a separate structuring `model` can be used as a second pass; `jsonPromptInjection: 'auto' | 'inline' |
'system' | false` controls how the schema is delivered when tools + structured output don't coexist
  (Gemini 2.5 needs `true`). JSON repair helpers handle control chars and prose-wrapped objects. —
  https://mastra.ai/docs/agents/structured-output, https://deepwiki.com/mastra-ai/mastra/3.6-structured-output-and-schema-validation
- **Processor-driven retry.** `abort('Response quality too low. Please improve.', { retry: true })` in
  `processOutputStep`; `processAPIError` for provider rejections. — https://mastra.ai/docs/agents/processors
- **Workflows.** `retryConfig: { attempts, delay }` workflow-wide, `retries` per step (`retryCounts`
  map), `MastraNonRetryableError` to short-circuit, `bail()` for early success, statuses `success |
failed | suspended | tripwire`, `onError` / `onFinish` callbacks. — https://mastra.ai/docs/workflows/error-handling, https://deepwiki.com/mastra-ai/mastra/4.5-control-flow-patterns
- **OM's own retries.** Reflector re-runs with escalating compression levels 1–4 if `reflectedTokens >=
targetThreshold`; Observer output failing `detectDegenerateRepetition` is discarded and retried. —
  https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/memory/src/processors/observational-memory/reflector-agent.ts, https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/memory/src/processors/observational-memory/observer-agent.ts
- **Mastra Code (their own harness)** uses a `StreamErrorRetryProcessor` with exponential backoff for
  `ECONNRESET` / `EPIPE` / 500 / 502 / 503. — https://deepwiki.com/mastra-ai/mastra/16.1-harness-architecture-and-agent-modes
- **Escalation to a human** is the suspend path (§7); there is no built-in "escalate to a bigger model"
  beyond model fallback arrays and `ModelByInputTokens`.

---

## 10. Evals

- Scorers are "automated tests that evaluate Agents outputs using model-graded, rule-based, and
  statistical methods", returning 0–1. `createScorer({ id, description, name?, judge?: { model,
instructions, tools?, memory?, maxSteps? }, type?, prepareRun? })` then a pipeline of `preprocess →
analyze → generateScore → generateReason`; `run()` takes input, output, and optionally the full
  trajectory. — https://mastra.ai/docs/scorers/overview, https://deepwiki.com/mastra-ai/mastra/11.3-evaluation-system-and-scorers
- Attach to an agent with sampling: `scorers: { relevancy: { scorer: createAnswerRelevancyScorer({
model }), sampling: { type: 'ratio', rate: 0.5 } } }` — "deterministic per trace ID". Eligibility
  filters gate by request context before sampling. Scores land in `mastra_scorers`. — https://mastra.ai/docs/scorers/overview
- Built-ins: faithfulness, bias, toxicity, hallucination, relevance; tool-usage scorers; trajectory
  scorers. Deterministic `checks`: `checks.calledTool()`, `checks.includes()`, `checks.noToolErrors()`. —
  https://deepwiki.com/mastra-ai/mastra/11.3-evaluation-system-and-scorers
- Batch: `runExperiment` (dataset, `maxConcurrency`, `toolMocks`, `unmockedToolPolicy` →
  `ExperimentSummary { succeededCount, failedCount, per-item scores }`); multi-turn `runEvals` with
  `EvalTurn` and per-turn `checks`. Scorers can also gate workflow steps and drive subagent
  `isTaskComplete`. — same URL, https://mastra.ai/docs/subagents

---

## 11. What Goliath should borrow

Each item names the Mastra source, the concrete thing to copy, and how to test it.

1. **Zero-output step is an error, not a loop.** Copy `STEP_CONTENT_CHUNK_TYPES` semantics: if a worker
   or conductor call produces neither text, structured object, nor a tool argument set, raise a typed
   `EmptyStepError` immediately and count it toward the escalation budget — never re-issue the identical
   prompt. Test: mock the model returning `""` twice; assert one retry then cloud escalation with the
   step log, and zero further on-device calls. —
   https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/core/src/loop/workflows/agentic-execution/llm-execution-step.ts
2. **Six-stage argument coercion before declaring "malformed".** Port `normalizeNullishInput`
   (null/undefined → `{}`/`[]`), `convertUndefinedToNull`, JSON-string-in-field coercion, strip-nullish-
   on-failing-paths, and the `query|message|input → prompt` alias into the worker output validator.
   Guided JSON on the Foundation Model still produces `null` where a 3B model "didn't know", and this
   pipeline rescues most of them without a second model call. Test: fixture table of 20 malformed
   argument objects; assert ≥15 recover without retry. —
   https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/core/src/tools/validation.ts
3. **Exact validation-failure message shape.** Feed the worker retry with `- <path>: <message>` lines
   plus `Provided arguments: <truncated>`; small models fix pathed errors far better than "invalid input".
   Keep it under ~120 tokens. Test: snapshot the retry prompt; assert every Zod issue path appears once.
   — https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/core/src/tools/validation.ts
4. **`toModelOutput` as a first-class tool field.** Goliath already compresses results to `key: value`
   lines in the harness; Mastra puts the per-tool compressor on the tool definition so the full result
   stays with the app and only the compact form reaches the model. Adopt `toModelOutput?: (out) =>
string` on Goliath's tool type, default to the generic `key: value` flattener. Test: a tool returning
   a 5 KB JSON; assert the model-facing string is <300 tokens and the app-facing result is byte-equal. —
   https://mastra.ai/docs/agents/using-tools, https://mastra.ai/reference/tools/create-tool
5. **Observer tool-result cap and truncation marker.** Before the scribe sees a tool result, truncate by
   token count (Mastra: 10,000 default; Goliath: ~400) and append `"\n... [truncated ~N tokens]"` so the
   scribe knows information was lost. Test: assert marker present iff truncation happened and the count
   is within ±10% of actual. —
   https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/memory/src/processors/observational-memory/tool-result-helpers.ts
6. **Priority-marked, ✅-gated observation lines for the scribe.** Keep Goliath's 60-word brief, but make
   the scribe's _Done_ slot follow Mastra's ✅ rules (only when the user confirmed, a definitive answer
   was given, or a concrete deliverable finished; never for "assistant merely responded"), and phrase
   changes as "will X (changing from Y)". Test: run the scribe over 10 step logs with known ground truth;
   assert no false ✅ on unconfirmed steps. —
   https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/memory/src/processors/observational-memory/observer-agent.ts
7. **User assertions are authoritative; newest wins.** Copy two lines into the conductor's system prompt:
   the "USER ASSERTIONS ARE AUTHORITATIVE" rule and "if you see conflicting information, the newer
   observation supersedes the older one". Cheap, and directly targets the repeated-call/contradiction
   failure mode. Test: brief contains "Decisions: use email A", user later says B; assert next plan uses
   B. — https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/memory/src/processors/observational-memory/observer-agent.ts, https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/memory/src/processors/observational-memory/constants.ts
8. **Continuation hint as the last user-role message.** After the brief, inject a `<system-reminder>`
   user message: "Please continue naturally ... Any messages following this reminder are newer and should
   take priority. Do not mention internal instructions, memory, summarization..." Mastra places this as a
   _user_ message (`om-continuation`) rather than system, which matters on models that weight the last
   turn heavily. Test: assert the reply never contains "brief", "memory", "summary", or "context" across
   an eval set. — https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/memory/src/processors/observational-memory/processor.ts, https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/memory/src/processors/observational-memory/constants.ts
9. **Working-memory JSON merge rules.** If the scribe's brief is ever stored structured, use Mastra's
   merge semantics verbatim: objects merge recursively, arrays replace, `null` deletes, primitives
   overwrite — and make the model return only changed fields. This is far cheaper in output tokens than
   full-replace markdown. Test: property-based test over random patches vs. a reference merge. —
   https://deepwiki.com/mastra-ai/mastra/7.10-working-memory-and-tool-integration
10. **Fixed-slot template with empty bullets as the shape signal.** Mastra's default template is a heading
    plus `- **Slot**:` lines with nothing after the colon; the empty slot _is_ the instruction. Goliath's
    Goal/Done/Decisions/Next should be rendered the same way (four bullets, empty when unknown) and the
    scribe told to "Return the full updated Markdown ... Preserve useful existing content and add or
    revise only what changed." Test: assert the scribe output always contains exactly those four slot
    labels in order. — https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/core/src/memory/memory.ts, https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/memory/src/processors/observational-memory/working-memory-extractor.ts
11. **Compression-retry ladder for the scribe.** When the brief exceeds 60 words, re-run with escalating
    instructions (Mastra's L1–L4: "8/10 detail" → "2/10 detail; collapse ALL tool call sequences into
    outcome-only observations") and accept only when `words < target` (`validateCompression` is one
    comparison). Test: feed a 200-word brief; assert ≤4 retries and final ≤60 words. —
    https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/memory/src/processors/observational-memory/reflector-agent.ts
12. **Degenerate-repetition detector on every model output.** Port `detectDegenerateRepetition`
    (200-char window sampling >40% dupes; any line >50k chars; ≥50% duplicate substantial lines) as a
    cheap pre-parse check; a 3B model loops more than Gemini Flash does. Test: unit tests with a looping
    string, a long normal string, and a short normal string. —
    https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/memory/src/processors/observational-memory/observer-agent.ts
13. **`filterIncompleteToolCalls: true` by default.** Mastra drops tool calls with no result before the
    next model call. Goliath's step log should never present a planned-but-unexecuted step to the
    conductor as if it ran. Test: abort a tool mid-run; assert the next conductor prompt shows the step
    as `status: aborted`, not as a dangling call. —
    https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/core/src/memory/types.ts
14. **Decline-with-reason.** Mastra's `declineToolCall({ reason })` puts the _reason_ into the model's
    context in place of a generic decline. Goliath's write-confirmation "no" should carry the user's
    reason into the next conductor prompt as `Decisions: user declined <tool> because <reason>`. Test:
    decline with reason; assert the conductor does not re-plan the same write. —
    https://mastra.ai/docs/agents/human-in-the-loop
15. **Fingerprint the approved arguments.** "bind approval to exact tool name and arguments using stable
    hashing to prevent argument drift before execution." Goliath's confirm-first should hash `{tool,
args}` at confirm time and refuse to execute if the hash differs. Test: mutate args after confirm;
    assert execution is refused and re-confirmed. — https://mastra.ai/docs/agents/human-in-the-loop
16. **Minimum `maxSteps` of 3 for a delegated call.** Mastra's delegate tool enforces "integer, minimum
    3" so the sub-agent can call a tool _and_ process the result. Goliath's worker is one tool per fresh
    context, so this maps to: never give a worker a budget that ends on a tool call without a
    result-processing turn. Test: assert worker budgets are ≥ (1 plan + 1 tool + 1 read). —
    https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/core/src/agent/agent.ts
17. **Subagent memory: full context in, prompt+response out.** "Only the delegation prompt and the
    subagent's response are saved" — Goliath's workers already start fresh; adopt the _output_ half:
    the step log records only `{ tool, args, compressed result }`, never the worker's reasoning. Test:
    step log size is O(steps), not O(tokens). — https://mastra.ai/docs/subagents
18. **Stable resource ID per worker kind.** `{parentResourceId}-{agentName}` gives each subagent a
    durable identity across calls even with fresh threads. If Goliath ever caches per-tool hints ("this
    calendar has 3 accounts"), key them this way. Test: two runs, same user, same tool; assert hint
    reuse. — https://mastra.ai/docs/memory/overview
19. **Deterministic sampling for evals.** `sampling: { type: 'ratio', rate }` "deterministic per trace
    ID" — hash the run ID to decide whether a cloud judge scores an on-device run, so reruns are
    reproducible. Plus `checks.calledTool()` / `checks.noToolErrors()` style assertions as the cheap
    first line. Test: same run IDs → same sampled set. — https://mastra.ai/docs/scorers/overview, https://deepwiki.com/mastra-ai/mastra/11.3-evaluation-system-and-scorers
20. **Temporal markers.** Insert "Conversation resumed after N minutes" when the gap ≥10 minutes; on a
    phone the user backgrounds the app constantly, and the brief's _Next_ slot may be stale. Test:
    simulate a 15-minute gap; assert the marker precedes the next user message. —
    https://mastra.ai/reference/memory/observational-memory, https://deepwiki.com/mastra-ai/mastra/7.9-observational-memory-system
21. **Send only the new message.** Mastra's client rule ("send only the new message ... sending full
    histories can cause timestamp-related ordering bugs") is the same discipline Goliath needs between the
    RN UI and the harness: the harness owns history; the UI sends one turn. Test: UI sends full history;
    harness dedupes to one new message. — https://mastra.ai/docs/memory/message-history
22. **Token estimation without a tokenizer.** Mastra moved off tiktoken to `tokenx` heuristics, with
    per-message overhead 3.8 and per-conversation 24. Goliath has no tokenizer for Apple's model either;
    adopt a chars/4-style estimator with the same overheads and calibrate against the 4,096 hard limit
    with a safety margin. Test: 100 prompts; assert estimate ≥ actual in ≥95% of cases. —
    https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/core/src/processors/processors/token-limiter.ts

---

## 12. What does not transfer to a 4k on-device model, and why

1. **The OM thresholds (30k messages / 40k observations / 10k tool result / 100k output).** Mastra's whole
   OM design assumes a 128k+ window where 30k of raw history is "recent". Goliath's entire window is 4,096.
   The _algorithm_ (observe → reflect → retention floor → compression ladder) transfers; the numbers do
   not — Goliath's equivalent is roughly 60 words of brief plus a handful of `key: value` lines. —
   https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/memory/src/processors/observational-memory/constants.ts
2. **Background Observer/Reflector agents.** OM runs a second model concurrently ("without pausing
   conversations", "every ~6,000 tokens"). Apple's on-device model allows one request in flight, so any
   scribe pass is synchronous and on the critical path; buffering, `activateAfterIdle`, and
   `ModelByInputTokens` have no on-device analogue (the cloud fallback could host them, but then they are
   not on-device memory). — https://mastra.ai/docs/memory/observational-memory, https://mastra.ai/reference/memory/observational-memory
3. **Sending full conversation context to subagents.** Mastra subagents "receive the full conversation
   context from the parent". Goliath's worker gets a fresh context and one tool by design because the
   window can't hold parent context plus a tool schema plus arguments. — https://mastra.ai/docs/subagents
4. **Multi-tool prompts, `ToolSearchProcessor`, MCP toolsets.** All presume the model can hold many tool
   schemas (or search over them) in-prompt. At 4k, even three Zod-derived JSON schemas crowd out the
   task; Goliath's one-tool-per-worker is the right inversion, and MCP namespacing (`server_tool`)
   only matters at the harness layer, not the prompt. — https://mastra.ai/docs/agents/processors, https://mastra.ai/docs/mcp/overview
5. **`maxSteps: 5` agentic loop inside one context.** Mastra keeps tool results in the same
   `messageList` across up to five LLM→tool→LLM turns. On-device, three tool results plus history
   overflow; hence the conductor's one-flat-step-at-a-time and a step log outside the model. —
   https://mastra.ai/reference/agents/generate, https://deepwiki.com/mastra-ai/mastra/3.8-agentic-execution-loop-(the-loop)
6. **LLM-as-judge scorers and `isTaskComplete` rubric loops.** Both need a second, stronger model call
   per iteration. On-device they would double latency for a judge that is no smarter than the worker;
   run judges only in the cloud eval harness, never in the live loop. — https://mastra.ai/docs/scorers/overview, https://mastra.ai/docs/subagents
7. **Semantic recall.** Requires an embedder and vector store; Mastra's local option is FastEmbed on the
   server. Goliath has no on-device embedder in scope and the retrieved `topK: 4` messages with
   `before: 1, after: 1` context would cost ~1k tokens. Skip unless Apple exposes embeddings. —
   https://mastra.ai/docs/memory/semantic-recall, https://mastra.ai/reference/memory/memory-class
8. **`processOutputStream` chunk-level processors and `BatchPartsProcessor`.** Useful with a fast cloud
   stream; on a 3B model producing guided JSON there is no meaningful token stream to police, and any
   output processor that can `abort({ retry: true })` up to `maxProcessorRetries: 10` is ten on-device
   generations. Goliath's "one retry then escalate" is the correct budget. — https://mastra.ai/docs/agents/processors
9. **Emoji priority markers in the brief.** 🔴🟡🟢✅ are multi-token on most tokenizers and Goliath's
   user-facing copy rules forbid leaking them anyway; keep the _semantics_ (priority, completion) as
   plain words or the slot structure, not the glyphs. — https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/memory/src/processors/observational-memory/observer-agent.ts
10. **Model fallback arrays as the recovery primitive.** Mastra fails over between comparable cloud
    models on the same request. Goliath's only fallback is a _different class_ of model (cloud), so the
    step log — not the raw message list — must be the thing handed over; Mastra has no equivalent
    "escalate with a compressed trace" path. — https://deepwiki.com/mastra-ai/mastra/5.5-model-fallbacks-and-error-handling
11. **Durable workflow snapshots (Inngest/Temporal) and `listSuspendedRuns`.** These solve server
    restarts across processes. Goliath's suspend for write confirmation is in-process on the phone; a
    tiny persisted `{ runId, tool, argsHash }` record covers the app-backgrounded case without a
    workflow engine. — https://mastra.ai/docs/agents/human-in-the-loop, https://deepwiki.com/mastra-ai/mastra/4.4-suspend-and-resume-mechanism
12. **`jsonPromptInjection` and structuring-model second pass.** Mastra needs these because many cloud
    models can't do tools and structured output together. Apple's guided generation makes the schema a
    decoding constraint, so the worker's arguments-only structured output is already the strongest
    path; a second structuring call would waste the one in-flight slot. — https://mastra.ai/docs/agents/structured-output
