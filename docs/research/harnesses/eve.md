# eve (Vercel) — harness research brief for Goliath

Studied: `eve@0.47.3` as installed in this monorepo, its bundled docs, the compiled harness source, the `eve` skill, Helen's own eve agent, and the public docs/repo/announcement. Every claim carries a path or URL. Local paths are under `/Users/davidhanlon/conductor/workspaces/helen/baghdad/` (abbreviated `$REPO`); eve's package is `$REPO/node_modules/eve/` (abbreviated `$EVE`). The dist is minified, so source quotes below were recovered from `$EVE/dist/src/**/*.js`.

Date: 2026-09-02.

---

## 1. What it is, in 5 lines

1. eve is Vercel's open-source, "filesystem-first framework for durable backend AI agents" — an agent is a directory (`instructions.md`, `tools/`, `skills/`, `channels/`, `subagents/`, `schedules/`, `agent.ts`) that eve compiles and runs (`$EVE/README.md`; https://github.com/vercel/eve; announced 2026-06-17, https://vercel.com/changelog/introducing-eve-an-open-source-agent-framework).
2. Every turn is a durable workflow on the open-source Workflow SDK: each model step is checkpointed, a crash resumes from the last step, and a turn can park for days on a human approval without holding compute (`$EVE/docs/concepts/execution-model-and-durability.mdx`).
3. The loop is the AI SDK `ToolLoopAgent`, driven one step at a time (`stopWhen: isStepCount(1)`), with automatic compaction at 90 % of the context window and a bounded retry/recovery pipeline around each model call (`$EVE/dist/src/harness/tool-loop.js`, `$EVE/dist/src/harness/compaction.js`).
4. Tools are Zod-typed files whose filename is the model-facing name; approvals (`always/once/never`), an `ask_question` tool, subagents (fresh context, `{ message, agentId?, outputSchema? }`), MCP/OpenAPI connections, and a per-session sandbox are built in (`$EVE/docs/tools/overview.mdx`, `$EVE/docs/subagents/index.mdx`).
5. It exposes one stable HTTP protocol — `POST /eve/v1/session`, `POST /eve/v1/session/:id`, NDJSON stream — which Helen already serves at `/eve/v1/*` via `withEve()` and authenticates with Convex Auth bearer tokens (`$REPO/apps/web/next.config.ts`, `$REPO/apps/web/src/agent/channels/eve.ts`).

---

## 2. The main loop

### Turn flow (session → turn → step)

- Nesting: **session** (durable conversation, 30-day default lifetime), **turn** (one user message and everything it triggers), **step** ("one model call and the tool calls it makes"; the durable checkpoint) — `$EVE/docs/concepts/execution-model-and-durability.mdx` § Sessions, turns, and steps.
- The harness "does one unit of AI work and returns `{ session, next }`"; the runtime persists state and follows `next` (`$EVE/README.md` § Architecture). Each unit is literally one model call: the AI SDK agent is created with `stopWhen: isStepCount(1)` (`$EVE/dist/src/harness/tool-loop.js`, search `stopWhen:isStepCount(1)`), so the outer harness/runtime decides whether to continue, wait, or finish after every step.
- Per step, `prepareStep` emits `step.started`, applies Anthropic cache-control markers or gateway auto-caching, and merges the provider safety identifier (`$EVE/dist/src/harness/step-hooks.js`). `onStepFinish` reconciles tool calls, tool results and tool errors into `actions.requested` / `action.result` / `step.completed` events (same file, `emitStepActions`, `reconcileToolResults`).
- System prompt assembly (in order): `Instructions (<name>)` block → workspace block → a fixed "Tool execution" paragraph ("A single tool or subagent call runs as one serial action. If you call multiple independent tools or subagents in one response, eve treats that batch as parallel work. Only batch work that is independent…") → "Agent messaging" paragraph when subagents exist → connections block → skills block (`$EVE/dist/src/runtime/prompt/compose.js`).

### Tool execution and result return

- eve runs authored tools in the app runtime (full Node, `process.env`); shell/file tools proxy into the sandbox (`$EVE/docs/concepts/security-model.md`). Parallel tool calls in one response run concurrently (`$EVE/docs/subagents/index.mdx` § built-in agent tool).
- Result to the model: full `execute` return by default; `toModelOutput(output)` can project it to `{ type: "text", value }`, `{ type: "json", value }`, or `content` parts (images) while channels/hooks still see the full output (`$EVE/docs/tools/overview.mdx` § Shape what the model sees). Outputs must be JSON-serializable; a non-serializable result throws `ToolOutputSerializationError` (`$EVE/dist/src/harness/tool-output-serialization.js`).
- A thrown tool becomes a `tool-result` part `{ type: "error-text", value: error.message }` and the model "can respond, choose another action, or call the tool again. eve does not automatically call the tool again" (`$EVE/dist/src/harness/action-result-helpers.js` `createToolResultMessagePartFromToolError`; `$EVE/docs/tools/overview.mdx` § When a tool throws).

### Step limits and stop conditions

- There is **no per-turn step cap** in the harness (no `maxSteps`/step-count constant exists in `$EVE/dist/src/harness/tool-loop.js`, `execution/session.js`, or `execution/workflow-steps.js`; the only `isStepCount` is `1`). The loop ends when the model produces a final text with no tool calls (`finishReason !== "tool-calls" && toolCalls.length === 0`, `handleStepResult` in `tool-loop.js`), when it parks for input, or when a limit trips.
- The real guardrails are **token budgets**: root sessions default to `maxInputTokensPerSession = 40_000_000` (`DEFAULT_ROOT_MAX_INPUT_TOKENS_PER_SESSION=4e7` in `$EVE/dist/src/execution/session.js`); `maxOutputTokensPerSession` unset by default. Crossing a limit pauses the session with a two-option `session-limit` input request (Approve = fresh window / Stop = cancel) whose prompt reads "This session has hit the input-token limit (40M) per session. This is a guardrail against defective long-running sessions…" (`$EVE/dist/src/harness/session-limit-continuation.js`; `$EVE/docs/agent-config.md` § Runtime limits). Task-mode sessions (schedules, delegated runs with no human) fail with `SESSION_TOKEN_LIMIT_REACHED` instead.
- Subagents get "a share of the delegating parent's remaining quota at dispatch time — the remainder … split evenly across the batch" (`$EVE/docs/agent-config.md`; `$EVE/dist/src/harness/subagent-token-budget.js` `grantShare = floor(remaining / batchSize)`).
- The `Workflow` tool caps subagent calls per program at `maxSubagents` (default 100) and is root-only so it cannot recurse (`$EVE/docs/concepts/built-in-tools.md` § Caps).
- Structured output: when a turn or subagent has an `outputSchema`, the final output is validated; if unmet the turn fails with `OUTPUT_SCHEMA_NOT_FULFILLED` (`finishConversation`/`finishTask` in `tool-loop.js`; `$EVE/docs/guides/client/output-schema.mdx`).

### Durability / resumption

- "Completed steps never re-run; eve replays the recorded result. A step interrupted mid-execution re-runs" — so tools must be idempotent or approval-gated (`$EVE/docs/concepts/execution-model-and-durability.mdx` § Resuming after a crash). eve runs each durable step up to four times (`$EVE/docs/concepts/sessions-runs-and-streaming.md` § The event envelope).
- Parked work (approval, OAuth, long subagent) suspends the workflow with no compute (`§ Parked work`). Local dev persists runs on disk under `.eve/.workflow-data`.
- Durable per-session state: `defineState(name, initial)` → `get()`/`update()`; never shared with subagents (`$EVE/docs/concepts/state.md`).

### Streaming / interrupts

- NDJSON stream with ~30 event types (`session.started`, `turn.started`, `message.received`, `step.started`, `action.input.appended`, `actions.requested`, `action.partial`, `action.result`, `input.requested`, `input.resolved`, `subagent.called/completed`, `reasoning.*`, `message.appended/completed`, `result.completed`, `compaction.requested/completed`, `step.completed/failed`, `turn.completed/failed/cancelled`, `session.waiting/failed/completed`); every event has `meta.id` (ULID) and `meta.at`; reconnect by absolute `startIndex` (`$EVE/docs/concepts/sessions-runs-and-streaming.md`).
- Message delivery defaults to `turnPolicy: "steer"`: a new message during an active turn buffers, cancels the turn (`turn.cancelled` → `session.waiting`), and starts a replacement turn; `"queue"` waits. `inputResponses` never steer (`§ Message delivery and steering`).
- Cancel: `POST /eve/v1/session/:id/cancel` (optional `turnId`), cascades to children; `202 accepted` / `200 no_active_turn`.

---

## 3. Context management

### Compaction triggers and thresholds (`$EVE/dist/src/harness/compaction.js`, `execution/session.js`)

- Config: `thresholdPercent` default `0.9`; `threshold = floor(contextWindowTokens * thresholdPercent)`, falling back to `100_000` tokens when the window is unknown; `recentWindowSize = 10` messages (`createCompactionConfig` in `execution/session.js`). The context window comes from the AI Gateway catalog (cached 24 h in session state) or `modelContextWindowTokens` — which is exactly why Helen's `agent.ts` sets it explicitly for OpenRouter (`$REPO/apps/web/src/agent/agent.ts`).
- Token estimate: `estimateTokens(messages) = JSON.stringify(messages).length / 4` (`$EVE/dist/src/harness/token-estimate.js`), improved by provider-reported `lastKnownInputTokens` for the already-sent prefix plus the estimate for new messages (`getInputTokenCount`).
- Trigger: `shouldCompact = messages.length > 0 && inputTokens + COMPACTION_PROMPT_OVERHEAD_TOKENS > threshold`, i.e. the fixed size of the checkpoint prompt itself is added before comparing (`compaction.js`; `$EVE/docs/concepts/default-harness.md` § Compaction).

### Compaction algorithm (`compactMessages`, `compaction.js`)

1. Peel off a previous checkpoint if history starts with the marker pair (user `"Summary of our conversation so far:"` / assistant `<summary>`).
2. Choose the recent window: walk back from the newest message, keep up to `recentWindowSize` (10) messages while `recentTokens + messageTokens + reserve <= threshold`, where `reserve = clamp(threshold/4, 64, 2048)` (`selectRecentWindowSize`, `resolveCompactionSummaryReserve`). Never split a tool-result off from its call (`splitMessagesForCompaction` advances past leading `tool` messages).
3. **Cheap heuristic first, no model call**: `toolResultCapHeuristic` keeps everything but caps every older tool result whose JSON exceeds `TRANSCRIPT_PAYLOAD_LIMIT = 2000` chars to `"[Truncated by eve: tool result reduced during context compaction. Re-run the tool if you need the full output.]\n\n" + first 2000 chars`. If that fits under threshold, done — no summary generated.
4. Otherwise call the compaction model (`generateText`, `temperature: 0`, same model as the turn unless overridden) with the checkpoint prompt; result replaces older messages as the marker pair + recent window. If still over, drop tool-result messages from the recent window (`keepNonToolResultMessages`), then shrink the window by one and loop. Manual/forced compaction (`d=true`) uses `recentWindowSize: 1`.
5. `withResumptionGuard`: if the compacted history ends on an assistant message, re-append the last real user message, or the literal `"Continue."` (`COMPACTION_RESUMPTION_MESSAGE`).

### Summary content — the exact prompts (`$EVE/dist/src/harness/compaction-prompt.js`)

System:

> You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.
> Include: – Current progress and key decisions made – Important context, constraints, or user preferences – What remains to be done, with clear next steps – Any critical data, examples, or references needed to continue
> Be concise, structured, and focused on helping the next LLM seamlessly continue the work. Write in the same language as the conversation. Do not continue the conversation, answer its questions, or invent facts. Only output the handoff summary.

User (`formatCompactionPrompt`):

```
<previous-checkpoint>
{previous checkpoint or "(none)"}
</previous-checkpoint>

<conversation>
Conversation transcript:
### user
...
### assistant
Called get_weather with {"city":"Brooklyn"}
### tool
Tool get_weather returned {"city":"Brooklyn",...}
</conversation>

Update the previous checkpoint with the newer information in the conversation. If there is no previous checkpoint, create one from the conversation.

Make completed work explicit so the next model does not repeat it. Keep completed work separate from current and remaining work, and do not describe completed work as pending unless later messages show it must be redone. Preserve exact file paths, function names, commands, error messages, identifiers, and measured values when they are needed to continue.

Large tool outputs are the main thing to compress: reduce each to the findings the next model needs — what was searched or read, what it established, and the exact identifiers involved — rather than reproducing the output. The next model cannot see the originals, so nothing it would need to act on may be lost.
```

- Transcript rendering: reasoning parts dropped; files become `Attached file <name> (<mediaType>)`; tool calls/results are JSON capped at 2000 chars, whitespace-collapsed, `…` suffix (`capText`). If the whole prompt still exceeds `transcriptBudgetTokens` (= threshold), `degradeOversizedTranscript` re-renders messages from the oldest forward with payload caps of 280 chars until it fits.
- Framework state survives compaction: read-before-write tracking is reset, and the active todo list is re-injected as a user message starting `[Your task list was preserved across context compaction]` followed by `- [x] [priority] item` lines (`$EVE/dist/src/execution/tools/todo.js` `formatTodoSummary`; `$EVE/docs/concepts/default-harness.md`).
- Memory records are excluded from the summary and recalled again after the checkpoint (`$EVE/docs/memory.md` § Lifecycle and compaction).

### Tool-result truncation and large outputs (outside compaction)

- Sandbox `bash`: stdout and stderr are each tail-truncated to `MAX_OUTPUT_LINES = 2000`, `MAX_OUTPUT_BYTES = 50 KiB`, each line capped at `MAX_LINE_LENGTH = 2000` chars with ` [truncated]`; the model sees a header `[stdout truncated: showing last N of M lines]` (`$EVE/dist/src/execution/sandbox/truncate-output.js`, `bash.js`).
- `read_file` returns numbered lines (`N: text`), stops at 50 KiB and returns `nextOffset`/`truncated: true` for paging (`$EVE/dist/src/execution/sandbox/read-file.js`).
- Image content parts warn above 3 MiB and are stubbed to text on compaction (`$EVE/dist/src/harness/tool-model-output.js` `CONTENT_FILE_WARN_BYTES`; `$EVE/docs/tools/overview.mdx`).
- Guidance: "Do not paste a file tree or large working dataset into the prompt. Seed files into the sandbox workspace and let the model inspect them" (`$EVE/docs/concepts/context-control.md`).

### Caching

- Anthropic-direct: `applyConversationCacheControl` puts cache markers on the conversation and `applyLastToolCacheBreakpoint` on the last tool definition; gateway models: `mergeGatewayAutoCaching` (`$EVE/dist/src/harness/step-hooks.js`, `prompt-cache.js`, `tool-loop.js`).
- Design choices made for cache stability: system instructions stay outside history; user-role instructions are append-only; the `[Agents]` note is appended "only when the listing changes (an append-only design that preserves the provider prompt cache)" (`$EVE/docs/instructions.mdx` § History controls; `$EVE/docs/subagents/index.mdx` § Agent messaging). Dynamic model switching is discouraged because "prompt caches are per model" (`$EVE/docs/agent-config.md`).

---

## 4. Tools

- **Definition**: `defineTool({ description, inputSchema, outputSchema?, approval?, execute(input, ctx), toModelOutput? })` in `agent/tools/<name>.ts`; filename = model-facing name; `inputSchema` required (Zod, Standard Schema, or JSON Schema; `z.object({})` for none) (`$EVE/docs/tools/overview.mdx`).
- **Description style**: one imperative sentence for the model. Built-ins: `bash` → "Execute a shell command in the shared workspace environment." (`$EVE/dist/src/tools/provided/bash.js`); `ask_question` → "Ask the user a question and wait for their response before continuing. Use this when you need clarification or a choice from the user." (`tools/framework/ask-question.js`); `agent` → "Delegate a focused subtask to a copy of yourself, or continue a previous delegation with `agentId`. … include essential context in `message` and give parallel writers non-overlapping scopes." (`tools/framework/agent-contract.js`). Field-level `.describe()` carries the usage rules (e.g. `agentId`: "Only pass this to continue a previous delegation … To start a new agent — the common case — omit this field entirely").
- **Validation**: the AI SDK validates tool-call input against the schema; an invalid call is turned into a `tool-error` part (`createInvalidToolCallInputError`, `$EVE/dist/src/harness/tool-call-input-errors.js`) and excluded from `actions.requested` (`step-hooks.js`), so the model sees the error and can retry — eve does not repair or re-prompt.
- **Result formatting**: see § 2 (`toModelOutput` text/json/content; error → `error-text`). Docs insist "Do not return secrets, credentials, unnecessary personal data" and to "filter, minimize, and redact tool outputs".
- **Streaming partials**: async-generator tools yield snapshots as `action.partial` (last-write-wins); only the final yield reaches the model.
- **Skills**: markdown `SKILL.md` (Agent Skills standard) advertised by description; body loaded only when the model calls `load_skill`; description is "a routing hint, not a label. Write it as the task that should trigger activation" (`$EVE/docs/skills.mdx`). Prompt block text: "If the user names a skill or the request clearly matches one of the descriptions below, call load_skill before proceeding. If multiple skills match, activate the minimal set…" then `- <name>: <description>` lines (`$EVE/dist/src/execution/skills/instructions.js`).
- **Connections**: MCP (`defineMcpClientConnection`) and OpenAPI; tools are not advertised up front — the model calls `connection_search` and matched tools become callable as `<connection>__<tool>` (`$EVE/docs/connections/overview.mdx`; prompt text in `$EVE/dist/src/runtime/prompt/connections.js`). Tokens are brokered in the app runtime and never reach the model.
- **Deferred loading / dynamic capability**: `defineDynamic({ events: { "session.started" | "turn.started" | "step.started": resolver } })` resolves tools, skills, instructions, subagents, or the model per session; a `step.started` resolver can swap the tool set before each model call (`$EVE/docs/guides/dynamic-capabilities.md`). "The harness advertises only the tools available to the current session" (`$EVE/docs/concepts/built-in-tools.md`).
- **Built-ins**: `bash`, `read_file` (line-numbered, enables read-before-write), `write_file` (enforces read-before-write and stale-read detection), `web_fetch` (≤10 redirects, SSRF-checked), `web_search`, `todo`, `ask_question`, `agent`, `load_skill`, `connection_search`; opt-in `glob`, `grep`, `sleep`, `Workflow`. Any default can be overridden by authoring the same slug or removed with `disableTool()`.

---

## 5. Subagents

- Two kinds: the root-only `agent` tool (a copy of the root: same instructions/tools/sandbox, fresh history and state) and declared subagents under `agent/subagents/<id>/` with their own `agent.ts` (`description` required), instructions, tools, skills, sandbox (`$EVE/docs/subagents/index.mdx`).
- **Isolation**: "A declared subagent inherits nothing from the root's authored slots"; state is never shared; child never sees the parent's history; the parent sees "only the subagent's final result" (`$EVE/docs/concepts/context-control.md`).
- **Input** (exact schema, `$EVE/dist/src/tools/framework/agent-contract.js`): `{ message: string; agentId?: string | null; outputSchema?: object }` — `message` must carry "all context the subagent needs".
- **Output**: the child's final text, or, with `outputSchema`, the validated structured value as the tool result. A child parks after answering and can be continued via `agentId`; `AGENT_BUSY` / `AGENT_MISMATCH` errors; eve appends a `[Agents]` note with an `<agents>` list whenever the set of parked children changes.
- **Limits**: no depth limit for declared nesting (bounded by the directory tree); `agent` cannot recurse; per-child token quota = parent's remaining share; model-call retries: "at most three fresh model-call attempts" plus one empty-response reissue, then one failed task result (`§ What the parent sees`). Cancelling a parent cancels children recursively.
- **Remote agents**: `defineRemoteAgent({ url, description, auth, forwardPrincipal })` calls another eve deployment's `POST /eve/v1/session` with a callback URL and parks until the terminal callback (`$EVE/docs/guides/remote-agents.md`). This is the mechanism an eve agent uses to accept work from another agent — see § 11 for Goliath's payload.

---

## 6. Memory and instructions

- **Instructions structure**: `agent/instructions.md` (system role, every call) or `instructions.ts` with `defineInstructions({ content, role: "system" | "user" })`; an `instructions/` directory composes alphabetically; user-role instructions are appended once to durable history. "Keep instructions short enough to justify including them on every model call" (`$EVE/docs/instructions.mdx`, `$EVE/docs/concepts/context-control.md`). Helen's is a two-line identity (`$REPO/apps/web/src/agent/instructions.md`).
- **Prompt composition**: system prompt = instructions + workspace hint + tool-execution rule + agent-messaging rule + connections list + skills list (`$EVE/dist/src/runtime/prompt/compose.js`). Runtime notes injected as _user_ messages: todo preservation, `[Agents]`, the empty-response nudge, `clientContext`.
- **Budgets**: no instruction-length cap; the context-window threshold is the only budget. File memory caps: `maxCharacters` default **4,000** chars for the recalled message, **2,048** bytes per entry, **65,536** bytes per document; "rejects rather than truncates" (`$EVE/docs/memory.md` § Use file memory).
- **Memory**: `defineMemory({ provider, scope, namespace?, visibility })` slots; `fileMemory()` gives the model `<slot>__save_memory` / `<slot>__remove_memory` and recalls one keyed document before each turn and after compaction; the model decides what to save ("does not automatically extract facts"). Custom providers implement `recall["turn.started"]` (required), `recall["compaction.completed"]`, `capture["turn.completed"]`, `capture["compaction.requested"]`, `tools`. Recalled items are untrusted user-role messages with stable `id`s that supersede earlier values (`$EVE/docs/memory.md`).
- **Injection**: `clientContext` on a client turn becomes one-turn user-role context ("Strings become user-role context messages … objects are JSON-serialized into one context message. It isn't persisted to durable session history") (`$EVE/docs/guides/client/messages.mdx`). Dynamic instructions at `session.started`/`turn.started` can inject per-tenant context.

---

## 7. Permissions and approvals

- Per tool: `approval: never() | once() | always() | policy(ctx)`; omitted = `never()`. A policy receives `{ session, toolName, toolInput, approvedTools, callId }` and returns `"user-approval" | "not-applicable" | "approved" | "denied" | { type: "denied", reason }` (`$EVE/docs/tools/human-in-the-loop.md`).
- A separate `approval.response` policy authorizes _who_ may approve (`responder.principalId`).
- Pause/resume protocol: model requests → `input.requested` event with `requests[]` each carrying `requestId`, `kind: "tool-approval" | "question" | "session-limit"`, `options[]` → session parks at `session.waiting` → client answers with `inputResponses: [{ requestId, optionId }]` or matching text. Unrelated text does not deny; the approval stays pending; a stale approval never authorizes.
- Approval doubles as replay safety: "a charge or email that sits behind `always()` can't fire from a re-run step without a fresh human decision."
- Route auth fails closed (401 unless an `AuthFn` accepts); connection tokens never reach the model; sandbox has no secrets (`$EVE/docs/concepts/security-model.md`).

---

## 8. Hooks / extensibility

- **Hooks**: `defineHook({ events: { "<event>"(event, ctx) } })` under `agent/hooks/`; observe-only, at-least-once, fire after the event is durably recorded; a throwing hook fails the turn (`$EVE/docs/guides/hooks.md`). Dispatch order per event: channel handler → metadata projection → hooks → dynamic resolvers.
- **Channels**: built-in eve HTTP, Slack, Discord, Telegram, Twilio, GitHub, Linear, Teams, MCP, plus `defineChannel({ routes: [POST(...), GET(...), WS(...)], events, state, metadata, turnPolicy })` with `from(address).send/respond/cancel/compact/clear/reset` and `attachSession(id)` (`$EVE/docs/channels/custom.mdx`).
- **Schedules**: `defineSchedule({ cron, markdown | run })`; markdown form is "task mode" (no parking, no HITL); becomes Vercel Cron in production (`$EVE/docs/schedules.mdx`).
- **Sandboxes**: `defineSandbox({ backend, bootstrap, networkPolicy })`; `defaultBackend()` picks Vercel Sandbox → Docker → microsandbox → just-bash; `/workspace` seeded from `agent/sandbox/workspace/`; credential brokering injects auth headers at the firewall (`$EVE/docs/sandbox.mdx`).
- **Extensions**: `eve extension init` packages tools/skills/subagents/channels for mounting under a namespace (`$EVE/docs/extensions.md`).
- **Background tasks** (experimental): `defineTool({ execution: "background" })` returns a receipt; the model is told to "acknowledge that the work started without waiting for results" (`$EVE/docs/tools/overview.mdx`).

---

## 9. Error handling and recovery

Source: `$EVE/dist/src/harness/tool-loop.js` and `model-call-error.js`.

- **Transient model errors**: `runModelCallWithRetries` — up to **3 attempts**, retry only when `classifyModelCallError(e) === "retry"`, backoff `500 * 2^(attempt-1) + rand(0..250)` ms. Classification: cancellation → `terminal`; `EmptyModelResponseError` → `recoverable`; `isRetryable` flag / tags `transient` / gateway `overloaded_error|rate_limit_exceeded|timeout_error` / HTTP 408, 409, 429, ≥500 → `retry`; `authentication_error|invalid_request_error|model_not_found` / other 4xx / config errors → `terminal`; otherwise `recoverable`.
- **Recovery pipeline** (after retries are exhausted): stage 1 `attemptUnsupportedProviderToolRecovery` disables provider tool types the model rejected and re-runs once with a system note "The following tool(s) … not available with the current model and has been removed: … Proceed using the remaining tools or your training knowledge."; stage 2 `attemptEmptyResponseRecovery` reissues the call **once** with a trailing user note: `"Your previous reply was empty and was not delivered. Answer now from the tool results above; do not re-run tools or mention this notice."` (`EMPTY_RESPONSE_NUDGE`). An empty step (no text, no tool calls) throws `EmptyModelResponseError` — "The model did not return a response. Please try again."
- **After recovery fails**: conversation mode → `emitRecoverableFailedTurn` with `MODEL_CALL_FAILED`; the session parks "for retry by the user" (a follow-up message restarts). Task mode → `recoverable` non-empty errors are rethrown so the durable step retries (up to 4 step attempts); otherwise the task fails with `MODEL_CALL_FAILED`. Stream-write failures park with `WORKFLOW_STREAM_WRITE_FAILED`.
- **Malformed tool input**: not retried by eve; converted to a `tool-error` result the model sees (`tool-call-input-errors.js`), and the next step lets the model correct itself.
- **Tool exceptions**: returned as `error-text`; "eve does not automatically call the tool again based on the exception type, an upstream HTTP status, or a `retryable` property" (`$EVE/docs/tools/overview.mdx`). Idempotency guidance: pass an idempotency key, or record an operation id before writing, or gate with approval.
- **Escalation to a human** is the only escalation: session-limit continuation prompt, approvals, `ask_question`. There is no cloud/bigger-model fallback inside eve; a _remote agent_ is the closest analogue (§ 5).
- Subagent failures surface as failed tool results (`REMOTE_AGENT_FAILED`, `SUBAGENT_UNAVAILABLE`, `WORKFLOW_SUBAGENT_LIMIT_REACHED`) so the parent can explain or recover.

---

## 10. Evals

Source: `$EVE/docs/evals/*.mdx`.

- Files: `evals/**/*.eval.ts`, each `defineEval({ description?, tags?, timeoutMs?, judge?, async test(t) })`; the file path is the id; a file may default-export an array to fan out over a dataset (`loadYaml`/`loadJson` from `eve/evals/loaders`, ids `sql/0000`…). One `evals/evals.config.ts` with `defineEvalConfig({ judge, reporters, maxConcurrency, timeoutMs })`.
- Evals run against the **real HTTP surface**: `eve eval` boots a dev server (or `--url` targets a deployment), polls `/eve/v1/health`, verifies `/eve/v1/info`, and drives sessions through `eve/client`.
- Drive API: `t.send`, `t.start` (live turn: `waitForEvent`, `cancel`, `result`), `t.respond`/`t.respondAll` (HITL), `t.sendFile`, `t.newSession`, `t.target.dispatchSchedule`, `t.target.attachSession`; read `t.reply`, `t.transcript`, `t.events`.
- Assertions: run-level `t.succeeded()`, `t.parked()`, `t.calledTool(name, { input, output, status, count })`, `t.notCalledTool`, `t.toolOrder([...])`, `t.usedNoTools()`, `t.maxToolCalls(n)`, `t.noFailedActions()`, `t.calledSubagent`, `t.event`/`t.eventOrder`/`t.eventsSatisfy`, `turn.outputMatches(schema)`; value-level `t.check(value, includes|equals|matches|similarity|satisfies)`; LLM judge `t.judge.autoevals.factuality|summarizes|closedQA|sql` (Braintrust autoevals semantics, never the model under test).
- Severity rides on the assertion: `.gate(threshold?)`, `.soft(threshold?)`, `.atLeast(threshold)`, `.label(name)`; run-level and `includes/equals/matches` are gates, `similarity` and judges are soft; `--strict` makes soft misses fail.
- Deterministic fixtures: `mockModel(text | ({ lastUserMessage, userMessageCount, tools, toolResults }) => text | { text, toolCalls, usage })` as the agent's model.
- CLI: `eve eval [ids] --url --tag --exclude-tag --strict --timeout --max-concurrency (default 8) --junit --json --list --verbose`; exit `0/1/2`; artifacts under `.eve/evals/<timestamp>/` (`summary.json`, `results.jsonl`, per-eval events).

---

## 11. What Goliath should borrow

Each item: what, why, how to test, source.

1. **Two-tier compaction: a free cap before the paid summary.** Before calling the scribe, cap each older tool result to N chars with a marker (`"[Truncated by eve: tool result reduced during context compaction. Re-run the tool if you need the full output.]\n\n" + slice`) and only summarize if the budget is still exceeded. For Goliath: N ≈ 300 chars per compressed `key: value` block; test that a turn with 5 tool results of 800 chars each never invokes the scribe. — `toolResultCapHeuristic`, `TRANSCRIPT_PAYLOAD_LIMIT = 2000`, `$EVE/dist/src/harness/compaction.js`, `compaction-prompt.js`.
2. **Budget the trigger, not the raw count.** `shouldCompact = est(history) + est(compactionPrompt) > threshold`. Goliath already has fixed slots; add `est(scribePrompt)` and `est(nextStepEnvelope)` to the check so the scribe call itself never overflows. Test: at threshold-1 tokens with a 300-token scribe prompt, compaction fires. — `COMPACTION_PROMPT_OVERHEAD_TOKENS`, `compaction.js`; `$EVE/docs/concepts/default-harness.md`.
3. **Tokens ≈ `JSON.stringify(x).length / 4`, corrected by the last provider-reported input count.** Apple's Foundation Models framework reports no usage, so keep the /4 estimate but calibrate the divisor once against a known 4,096 overflow error and store it. Test: estimate within ±15 % on a 10-sample corpus. — `$EVE/dist/src/harness/token-estimate.js`, `getInputTokenCount`.
4. **Checkpoint prompt wording.** Reuse the four bullets ("Current progress and key decisions", "Important context, constraints, or user preferences", "What remains to be done, with clear next steps", "critical data … references") and the three rules: keep completed separate from pending, preserve exact identifiers, compress tool outputs to "what was searched, what it established, the exact identifiers." Map them onto Goliath's Goal/Done/Decisions/Next slots; the "do not describe completed work as pending" sentence directly prevents the repeated-call escalation. Test: scribe output after a completed `createReminder` step lists it under Done, never Next. — `COMPACTION_SYSTEM_PROMPT`, `formatCompactionPrompt`, `$EVE/dist/src/harness/compaction-prompt.js`.
5. **Update the previous checkpoint rather than re-summarizing from scratch.** eve passes `<previous-checkpoint>` un-truncated and a `<conversation>` of only the new messages. Goliath's scribe should receive `brief_prev + new step lines`, not the whole log. Test: brief token count stays ≤ 60 words after 20 steps. — `createCompactionPrompt`, `extractPreviousCheckpoint`.
6. **Never split a tool call from its result, and never end on the assistant.** `splitMessagesForCompaction` advances past leading `tool` messages; `withResumptionGuard` appends the last real user message or the literal `"Continue."`. Test: after compaction the last message is always user-role. — `compaction.js`.
7. **Degrade payloads before dropping messages.** When the transcript is over budget, eve re-renders oldest-first with 280-char caps (`degradeOversizedTranscript`) before shrinking the window. Goliath: cap `key: value` lines to 280 chars oldest-first before dropping step-log lines. Test: a 4-step log with one 3 KB result fits without losing any step. — `compaction-prompt.js`.
8. **Re-inject framework state after compaction as a labeled user note.** `[Your task list was preserved across context compaction]` + `- [x] [priority] item`. Goliath's plan/todo (the conductor's remaining steps) should be re-injected verbatim after each scribe pass, labeled, so the model does not treat it as user speech. Test: plan survives compaction byte-for-byte. — `TODO_COMPACTION_PRESERVATION_LABEL`, `$EVE/dist/src/execution/tools/todo.js`.
9. **Empty-answer nudge before escalation.** Reissue once with the trailing user note `"Your previous reply was empty and was not delivered. Answer now from the tool results above; do not re-run tools or mention this notice."` Only escalate to `httpFallback` if the reissue is also empty. Test: mock model returns `""` then a reply — no escalation; `""` twice — escalation with reason `empty-response`. — `EMPTY_RESPONSE_NUDGE`, `attemptEmptyResponseRecovery`, `$EVE/dist/src/harness/tool-loop.js`.
10. **Classify model errors into retry / recoverable / terminal, with capped retries.** eve: 3 attempts, `500·2^(n-1)+jitter(250)` ms, retry only transient classes. Goliath on-device: Foundation Models errors like `exceededContextWindowSize`, `guardrailViolation`, `unsupportedLanguageOrLocale` are terminal → escalate immediately; `concurrentRequests`/availability errors → retry with the same backoff (max 3). Test: a table-driven classifier test with one case per error. — `classifyModelCallError`, `runModelCallWithRetries`, `$EVE/dist/src/harness/model-call-error.js`, `tool-loop.js`.
11. **Malformed tool input is data, not an exception.** Convert a schema failure into a tool-error result the model sees, then let the next step correct; only after Goliath's existing one retry, escalate. Keep the error message short and name the field. Test: `date: "tomorrow"` against a `z.string().datetime()` field yields a second attempt with an ISO string. — `createInvalidToolCallInputError`, `$EVE/dist/src/harness/tool-call-input-errors.js`.
12. **Tool description = one imperative sentence + field-level `.describe()` rules.** Move usage rules ("Only pass this to continue…", "omit this field entirely") into per-field descriptions so the tiny model sees them next to the field, not in a paragraph. Test: worker structured output omits `agentId`-style optional fields when not needed ≥ 95 % on a 20-case eval. — `SUBAGENT_TOOL_INPUT_SCHEMA`, `$EVE/dist/src/tools/framework/agent-contract.js`.
13. **`toModelOutput` as a first-class tool field.** Let each Goliath tool declare its own compression (`toModelOutput(output) → { type: "text", value }`) rather than a global `key: value` flattener; keep the full output for the UI/step log. Test: a calendar search returning 30 events yields ≤ 5 lines to the model, all 30 to the log. — `$EVE/docs/tools/overview.mdx` § Shape what the model sees.
14. **Hard byte caps on raw tool output with a header, tail-biased.** 50 KiB / 2,000 lines / 2,000 chars per line, prefixed `[stdout truncated: showing last N of M lines]`. Goliath's equivalent: 1,200 chars per result on a 4 k window, with `[truncated: N of M items]`. Test: any tool result rendered to the model is ≤ cap. — `$EVE/dist/src/execution/sandbox/truncate-output.js`.
15. **Approval kinds as a discriminated request.** `input.requested` carries `requests[]` each with `requestId`, `kind ∈ {tool-approval, question, session-limit}`, `options[{ id, label, description, style }]`, `allowFreeform`, `display`. Adopt this exact shape for Goliath's "writes confirm first" UI so the same renderer handles confirmations, questions, and budget prompts. Test: snapshot of the three request kinds. — `$EVE/dist/src/harness/session-limit-continuation.js`, `$EVE/docs/tools/human-in-the-loop.md`.
16. **`once()` approval semantics.** Ask once per session for a given write tool, then auto-allow; keep `always()` for irreversible ones. Test: two `createReminder` calls in one session prompt once. — `$EVE/docs/tools/human-in-the-loop.md`.
17. **Stale approvals never authorize.** A response to a request that was cleared or superseded is delivered as a plain message; the model must request again. Goliath: bind each confirmation to `callId` and reject if the pending call differs. — `$EVE/docs/concepts/sessions-runs-and-streaming.md` § Send a follow-up message.
18. **Per-session token budget with a human continuation prompt.** Goliath should count cumulative on-device tokens per session and, at a cap (e.g. 200 k), park with Approve/Stop rather than silently continuing; the prompt text ("This is a guardrail against defective long-running sessions. If session activity looks fine, just approve to keep going.") is reusable. Test: cap at 1,000 tokens in a test → third step parks. — `$EVE/dist/src/harness/session-limit-continuation.js`.
19. **Subagent = fresh context + `message` carries everything + optional `outputSchema`.** This is Goliath's worker design already; borrow the parent-side rule "give parallel writers non-overlapping scopes" and the `AGENT_BUSY` rule (do not message a running worker). — `$EVE/docs/subagents/index.mdx`.
20. **Append-only, change-triggered runtime notes.** Only re-emit the `[Agents]`/plan note when its contents change, to keep the prefix stable. On-device there is no prompt cache, but stability still reduces conductor drift; test that identical plans produce identical prompts. — `$EVE/docs/subagents/index.mdx` § Agent messaging.
21. **Skill routing sentence.** "If the user names a skill or the request clearly matches one of the descriptions below, call load_skill before proceeding. If multiple skills match, activate the minimal set that covers the task." Use it verbatim if Goliath adds on-demand procedure loading. — `$EVE/dist/src/execution/skills/instructions.js`.
22. **Eval vocabulary.** Adopt `calledTool(name, { input, count })`, `toolOrder`, `maxToolCalls(n)`, `noFailedActions()`, `parked()`, and `mockModel(({ toolResults }) => …)` for Goliath's harness tests; assert on the step log the way eve asserts on the event stream. — `$EVE/docs/evals/assertions.mdx`, `overview.mdx`.
23. **Event envelope for the step log.** Give every step-log entry `{ id: ULID, at: ISO, type, data: { turnId, stepIndex, sequence } }` so the log dedupes on `id` and orders on `stepIndex/sequence` — and so an eve endpoint can ingest it unchanged. — `$EVE/docs/concepts/sessions-runs-and-streaming.md` § The event envelope.
24. **Idempotent create with `operationId`.** When Goliath escalates, send `operationId = <goliath turnId>` so a retried POST returns the same session instead of running the ask twice. — `$EVE/docs/channels/eve.mdx` § Start and continue a session.

### The `httpFallback` payload — accepting a Goliath turn as an eve endpoint

eve's create route is `POST /eve/v1/session` with body `{ message, clientContext?, outputSchema?, operationId? }`, reply `{ ok, sessionId, status: "accepted" }` (+ `x-eve-session-id` header), then `GET /eve/v1/session/:sessionId/stream` (NDJSON) or `POST /eve/v1/session/:sessionId` with `{ message } | { inputResponses }` for follow-ups (`$EVE/docs/channels/eve.mdx`; `$EVE/docs/guides/client/messages.mdx`). `clientContext` is one-turn, user-role, not persisted to history; objects are JSON-serialized into one message (`messages.mdx`). `outputSchema` is per-turn and the result lands on `result.completed` / `MessageResult.data` (`output-schema.mdx`). Helen's endpoint already exists at `https://<helen-web>/eve/v1/session` and accepts a Convex Auth session JWT as `Authorization: Bearer` (`$REPO/apps/web/src/agent/channels/eve.ts`, `convexUser`), so the mobile app's existing token works.

Recommended shape (TypeScript, Goliath side):

```ts
type GoliathFallbackRequest = {
  // What eve reads as the user turn. Put the durable facts here, not only in
  // clientContext, because clientContext is dropped from history after the turn.
  message: string; // `${ask}\n\n[Brief]\nGoal: …\nDone: …\nDecisions: …\nNext: …`
  // One-turn context the model sees but eve does not persist.
  clientContext: {
    goliath: {
      version: "1";
      reason:
        | "repeated-call"
        | "empty-response"
        | "malformed-plan"
        | "model-error"
        | "context-overflow"
        | "user-request";
      ask: string; // the user's original request, verbatim
      brief: { goal: string; done: string; decisions: string; next: string }; // ≤ 60 words total
      stepLog: Array<{
        id: string; // ULID
        at: string; // ISO-8601
        stepIndex: number;
        tool: string;
        input: Record<string, unknown>;
        output: string; // the compressed key: value lines the model saw (≤ 1,200 chars)
        status: "completed" | "failed" | "rejected" | "pending";
        error?: string;
      }>;
      toolsAvailable: string[]; // names only; eve has its own tool set
      device: { model: string; contextWindowTokens: 4096; locale: string };
    };
  };
  // Ask eve for a structured answer so Goliath can resume rather than parse prose.
  outputSchema: {
    type: "object";
    properties: {
      answer: { type: "string" }; // what to say to the user
      brief: {
        type: "object";
        properties: {
          goal: { type: "string" };
          done: { type: "string" };
          decisions: { type: "string" };
          next: { type: "string" };
        };
        required: ["goal", "done", "decisions", "next"];
      };
      handoff: {
        type: "string";
        enum: ["complete", "resume-on-device", "needs-user"];
      };
    };
    required: ["answer", "brief", "handoff"];
  };
  operationId: string; // Goliath turnId — create-once on retry (authenticated callers only)
};
```

Wire details:

- Headers: `Authorization: Bearer <convex session jwt>`, `content-type: application/json`. Persist `{ sessionId, streamIndex }` (eve's `ClientSessionState`) on device so a later escalation in the same conversation continues the same eve session with `POST /eve/v1/session/:id` instead of creating one (`$EVE/docs/guides/client/continuations.mdx`).
- Read the reply from the stream: `message.completed` (text) and `result.completed.data.result` (structured); `input.requested` means eve wants an approval — surface it with the same request renderer as Goliath's own confirmations and answer with `{ inputResponses: [{ requestId, optionId }] }`.
- On `409 session_not_active` create a fresh session; do not retry the same id.
- On the eve side, nothing special is needed: the default `eveChannel` accepts this body. Optionally add `onMessage(ctx, message)` to stamp `context: [...]` from `clientContext.goliath` or a dynamic user-role instruction at `turn.started` that renders the step log as `### step N` lines mirroring eve's own transcript format (`$EVE/docs/channels/eve.mdx` § Customization; `$EVE/docs/guides/dynamic-capabilities.md`).

---

## 12. What does not transfer to a 4 k on-device model, and why

1. **The "no step cap, budget by tokens" loop.** eve tolerates unbounded steps because context is 100 k–1 M tokens and compaction is cheap relative to the window. With 4,096 tokens and one request in flight, every extra step costs a full re-prompt; Goliath's fixed flat plan and explicit step limit are the right inversion. — `$EVE/dist/src/harness/tool-loop.js` (`isStepCount(1)`, no cap), `execution/session.js` (40 M default).
2. **Compaction thresholds and window size.** `0.9 × window`, `recentWindowSize = 10`, `reserve = clamp(window/4, 64, 2048)`, 2,000-char tool payloads. At 4 k tokens, 0.9 leaves ~400 tokens for the answer, a 10-message window is the whole history, and a single 2,000-char payload is ~500 tokens. Goliath must budget per slot (brief ≤ 60 words, ~100 tokens; step envelope ≤ ~600 tokens; result ≤ ~300 tokens) rather than by percentage. — `compaction.js`.
3. **Summaries by the same model, at temperature 0, in free prose.** eve's checkpoint is open-ended text from a frontier model. A 3B model with guided output should fill fixed slots (Goal/Done/Decisions/Next) — Goliath's scribe — not write a handoff essay; and it should use guided JSON so the slots cannot be malformed. — `compaction-prompt.js`.
4. **Advertising all tools plus `connection_search`, skills lists, and `[Agents]` notes every call.** Each is a prompt block on every step; on-device, tool schemas alone can consume the window, which is exactly why Goliath gives each worker one tool. Keep the conductor's tool list to names + one-line descriptions, never JSON schemas. — `$EVE/dist/src/runtime/prompt/compose.js`, `$EVE/docs/concepts/built-in-tools.md`.
5. **Parallel tool batches in one response.** eve's "batch = parallel work" rule assumes the model can emit several validated calls at once and the runtime can run them concurrently. Apple's framework allows one request in flight, and a 3B model emitting multiple calls raises the malformed-plan rate; one flat step per turn stays. — `compose.js` "Tool execution" paragraph.
6. **Prompt caching strategies.** Cache breakpoints, append-only notes, and "don't switch models mid-session" exist to protect provider caches. There is no prompt cache on device (each request re-encodes), so these buy nothing except stability; do not spend design effort on them. — `step-hooks.js`, `prompt-cache.js`.
7. **Durable workflows, parking for days, crash replay.** Vercel Workflow checkpoints each step to a store; on device the "store" is local and the process is the app. What transfers is the _contract_ (idempotent tools, `operationId`, step log with ids), not the engine. — `$EVE/docs/concepts/execution-model-and-durability.mdx`.
8. **Sandbox, `bash`/`read_file`/`write_file`, workspace seeding.** These presuppose a microVM and a shell; iOS has neither. The transferable idea is "put big data behind a tool, not in the prompt." — `$EVE/docs/sandbox.mdx`.
9. **LLM-as-judge evals and Braintrust reporters.** Goliath's evals should be deterministic on the step log (tool order, counts, no failed actions, escalation reason) with `mockModel`-style fixtures; a judge model is a cloud dependency the on-device story is trying to avoid. — `$EVE/docs/evals/judge.mdx`.
10. **Model-error taxonomy tied to gateway/HTTP signals.** eve classifies by HTTP status and AI Gateway error types. Foundation Models throws typed Swift errors (`LanguageModelSession.GenerationError` cases such as `exceededContextWindowSize`, `guardrailViolation`, `unsupportedGuide`, `concurrentRequests`); Goliath needs its own table, with the retry/recoverable/terminal _categories_ borrowed but every rule rewritten. — `model-call-error.js`.
11. **File-memory sizes.** 4,000-char recall messages and 64 KiB documents would consume a quarter of the window; on-device memory recall must be a handful of lines selected per ask, or live behind a tool. — `$EVE/docs/memory.md`.
12. **Free-text approval matching.** eve lets a typed "approve" resolve a pending request by option label or index and tolerates unrelated text. With guided output the confirmation should be a UI control, not a parsed reply — the model never sees the user's confirmation text. — `$EVE/docs/tools/human-in-the-loop.md` § How pause and resume works.

---

## Sources

Local (eve 0.47.3):

- `$REPO/node_modules/eve/README.md`, `CHANGELOG.md`, `package.json`
- `$REPO/node_modules/eve/docs/` — `README.md`, `agent-config.md`, `instructions.mdx`, `skills.mdx`, `memory.md`, `sandbox.mdx`, `schedules.mdx`, `extensions.md`, `concepts/{default-harness.md, built-in-tools.md, context-control.md, execution-model-and-durability.mdx, sessions-runs-and-streaming.md, state.md, security-model.md}`, `tools/{overview.mdx, human-in-the-loop.md}`, `subagents/index.mdx`, `connections/overview.mdx`, `channels/{eve.mdx, custom.mdx}`, `guides/{hooks.md, dynamic-capabilities.md, remote-agents.md, client/messages.mdx, client/output-schema.mdx, client/continuations.mdx}`, `evals/{overview, cases, assertions, judge, running, targets}.mdx`
- `$REPO/node_modules/eve/dist/src/harness/{tool-loop.js, compaction.js, compaction-prompt.js, token-estimate.js, step-hooks.js, model-call-error.js, tool-call-input-errors.js, tool-model-output.js, tool-output-serialization.js, action-result-helpers.js, session-limit-continuation.js, subagent-token-budget.js}`
- `$REPO/node_modules/eve/dist/src/{runtime/prompt/compose.js, runtime/prompt/connections.js, execution/session.js, execution/sandbox/truncate-output.js, execution/sandbox/bash.js, execution/sandbox/read-file.js, execution/tools/todo.js, execution/skills/instructions.js, tools/framework/agent-contract.js, tools/framework/ask-question.js, tools/provided/bash.js}`
- `$REPO/.agents/skills/eve/SKILL.md` (points at the bundled docs as the source of truth)
- `$REPO/apps/web/src/agent/{agent.ts, instructions.md, channels/eve.ts}`, `$REPO/apps/web/next.config.ts`, `$REPO/apps/web/package.json`

Web:

- https://github.com/vercel/eve — repo (Apache-2.0, preview/beta)
- https://github.com/vercel/eve/blob/main/AGENTS.md — package layout (`packages/eve` = framework + CLI)
- https://eve.dev/docs/concepts/default-harness — compaction (thresholdPercent 0.9)
- https://deepwiki.com/vercel/eve and https://deepwiki.com/vercel/eve/2.3-harness-and-tool-loop — names `packages/eve/src/harness/{tool-loop.ts, emission.ts, step-hooks.ts, input-requests.ts, compaction.ts}` and the AI SDK `ToolLoopAgent`
- https://vercel.com/blog/introducing-eve and https://vercel.com/changelog/introducing-eve-an-open-source-agent-framework — launch 2026-06-17; "every conversation is a durable workflow with each step checkpointed"
- https://vercel.com/docs/eve, https://vercel.com/kb/eve — hosted docs mirrors
- https://workflow-sdk.dev/ — the durability layer eve builds on
