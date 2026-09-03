import type { LanguageModel } from "ai";
import { plan, type Plan } from "./conductor.js";
import { judgeAnswer, judgeStep, judgeToolFailures } from "./judge.js";
import { DEFAULT_INSTRUCTIONS } from "./prompts.js";
import { remember } from "./scribe.js";
import type {
  Confirm,
  EscalationReason,
  Fallback,
  Memory,
  MemoryState,
  PlanExample,
  RunResult,
  StepRecord,
  ToolMap,
  TraceEvent,
} from "./types.js";
import { runAnswerStep, runToolStep } from "./worker.js";

type TurnInput = {
  ask: string;
  model: LanguageModel;
  tools: ToolMap;
  memory: Memory;
  confirm: Confirm;
  fallback?: Fallback;
  instructions?: string;
  maxSteps: number;
  window: number;
  facts?: Record<string, string>;
  examples?: PlanExample[];
  onEvent?: (event: TraceEvent) => void;
  signal?: AbortSignal;
};

/**
 * One turn, start to finish: recall, then up to `maxSteps` stones, then an
 * answer, then remember. Every escalation path goes through `escalate` so the
 * cloud always receives the same shape.
 */
const runTurn = async (input: TurnInput): Promise<RunResult> => {
  const instructions = input.instructions ?? DEFAULT_INSTRUCTIONS;
  const trace: TraceEvent[] = [];
  const steps: StepRecord[] = [];
  const emit = (event: TraceEvent) => {
    trace.push(event);
    input.onEvent?.(event);
  };

  const state = await input.memory.load();
  emit({ type: "recall", summary: state.summary, recent: state.recent.length });

  const escalate = async (reason: EscalationReason, error?: string): Promise<RunResult> => {
    emit({ type: "escalate", reason, ...(error ? { error } : {}) });
    if (!input.fallback) {
      // No cloud to hand to. smolagents still answers from memory on max
      // steps rather than returning nothing; so does Goliath, unless the
      // model itself is what failed.
      if (reason === "model-error") return { text: "", handledBy: "device", steps, trace };
      const text = await bestEffortAnswer(input, instructions, state.summary, steps);
      if (text) emit({ type: "answer", text });
      return { text, handledBy: "device", bestEffort: true, steps, trace };
    }
    const { text } = await input.fallback({
      ask: input.ask,
      summary: state.summary,
      recent: state.recent,
      steps,
      reason,
      ...(error ? { error } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    await commit(input, state, { ask: input.ask, answer: text, at: Date.now() }, emit);
    return { text, handledBy: "cloud", steps, trace };
  };

  const hasTools = Object.keys(input.tools).length > 0;

  try {
    return await stones();
  } catch (error) {
    // Guardrail violations, refusals, a dead session after context overflow,
    // an unavailable model: none of these are the app's fault, and none are
    // worth retrying with the same input. The cloud gets the same step log.
    if (isAbort(error)) throw error;
    if (isGuardrail(error)) {
      // Apple's guardrail objects to text in the prompt or the reply. On a
      // step that carries tool output that is usually a false positive on a
      // calendar title, not an attack; either way, escalating would ship the
      // very text it flagged. Stop here and let the app tell the user.
      emit({ type: "escalate", reason: "guardrail", error: describeError(error) });
      return { text: "", handledBy: "device", steps, trace };
    }
    return escalate("model-error", describeError(error));
  }

  async function stones(): Promise<RunResult> {
    let planRetried = false;
    let retryHint: string | undefined;
    for (;;) {
      const stall = judgeStep({ steps, maxSteps: input.maxSteps });
      if (stall) return escalate(stall);

      const outcome = hasTools
        ? await plan({
            model: input.model,
            instructions,
            tools: input.tools,
            ask: input.ask,
            summary: state.summary,
            steps,
            maxSteps: input.maxSteps,
            window: input.window,
            emit,
            ...(input.facts ? { facts: input.facts } : {}),
            ...(input.examples ? { examples: input.examples } : {}),
            ...(retryHint ? { retryHint } : {}),
            ...(input.signal ? { signal: input.signal } : {}),
          })
        : { ok: true as const, plan: { kind: "answer", brief: "reply" } as Plan };

      if (!outcome.ok) {
        // Small models drop a brace now and then. One more try, told what was
        // wrong (Claude Code feeds the validation error back), is cheap and
        // usually enough; two failures in a row is a real signal.
        if (planRetried) return escalate("plan-invalid");
        planRetried = true;
        retryHint = outcome.hint;
        continue;
      }
      retryHint = undefined;
      const next = outcome.plan;
      emit({
        type: "plan",
        index: steps.length,
        kind: next.kind === "escalate" ? "answer" : next.kind,
        ...(next.tool ? { tool: next.tool } : {}),
        ...(next.why ? { why: next.why } : {}),
        brief: next.brief,
      });

      if (next.kind === "escalate") return escalate("conductor-asked");

      if (next.kind === "answer") {
        const answerInput = {
          model: input.model,
          instructions,
          ask: input.ask,
          summary: state.summary,
          steps,
          ...(input.signal ? { signal: input.signal } : {}),
        };
        let text = await runAnswerStep(answerInput);
        if (judgeAnswer(text)) {
          // eve, OpenClaw, and Hermes all reissue once with a nudge before giving up.
          text = await runAnswerStep({ ...answerInput, nudge: EMPTY_ANSWER_NUDGE });
        }
        const empty = judgeAnswer(text);
        if (empty) return escalate(empty);
        steps.push({ index: steps.length, kind: "answer", brief: next.brief, text });
        emit({ type: "answer", text });
        await commit(input, state, { ask: input.ask, answer: text, at: Date.now() }, emit);
        return { text, handledBy: "device", steps, trace };
      }

      const tool = input.tools[next.tool ?? ""];
      if (!tool) return escalate("plan-invalid");

      const started = Date.now();
      // Claude Code answers an identical re-read with a stub instead of the
      // file. A first repeat of a read-only tool gets the earlier result back
      // with no model call and no execution; a second repeat is a real loop.
      const cached = !tool.writes ? findRepeatOfReadOnly(steps, tool.name) : undefined;
      if (cached) {
        const record: StepRecord = {
          index: steps.length,
          kind: "tool",
          brief: next.brief,
          tool: tool.name,
          input: cached.input,
          result: `same as step ${cached.index + 1}`,
          cached: true,
        };
        steps.push(record);
        emit({
          type: "tool",
          tool: tool.name,
          input: cached.input,
          result: record.result ?? "",
          ms: 0,
        });
        continue;
      }
      const done = await runToolStep({
        model: input.model,
        instructions,
        tool,
        brief: next.brief,
        ask: input.ask,
        confirm: async (request) => {
          const decision = await input.confirm(request);
          const approved = typeof decision === "boolean" ? decision : decision.approved;
          const reason = typeof decision === "object" ? decision.reason : undefined;
          emit({ type: "confirm", tool: request.tool, approved, ...(reason ? { reason } : {}) });
          return decision;
        },
        ...(input.signal ? { signal: input.signal } : {}),
      });

      if (!done.ok) return escalate(done.reason);

      const repeat = judgeStep({
        steps,
        maxSteps: input.maxSteps,
        next: { tool: tool.name, input: done.input },
      });
      if (repeat === "repeated-tool-call") return escalate(repeat);

      steps.push({
        index: steps.length,
        kind: "tool",
        brief: next.brief,
        tool: tool.name,
        input: done.input,
        result: done.result,
        skipped: done.skipped,
        ...(done.failed ? { failed: true } : {}),
      });
      emit({
        type: "tool",
        tool: tool.name,
        input: done.input,
        result: done.result,
        ms: Date.now() - started,
      });
      const failing = judgeToolFailures(steps);
      if (failing) return escalate(failing, steps.at(-1)?.result);
    }
  }
};

/**
 * The most recent step with this read-only tool, when no step has already
 * been served from cache for it. Argument equality is checked by the judge
 * after the worker runs; here the tool name alone is the signal, because a
 * no-argument tool never reaches the worker.
 */
const findRepeatOfReadOnly = (steps: StepRecord[], toolName: string): StepRecord | undefined => {
  const same = steps.filter((s) => s.kind === "tool" && s.tool === toolName);
  const last = same.at(-1);
  if (!last || last.cached) return undefined;
  if (last.input !== undefined && Object.keys(last.input as object).length > 0) return undefined;
  return last;
};

/** One answer call from the step log; an empty or failing call yields "". */
const bestEffortAnswer = async (
  input: TurnInput,
  instructions: string,
  summary: string,
  steps: StepRecord[],
): Promise<string> => {
  try {
    return await runAnswerStep({
      model: input.model,
      instructions,
      ask: input.ask,
      summary,
      steps,
      bestEffort: true,
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch (error) {
    if (isAbort(error)) throw error;
    return "";
  }
};

const EMPTY_ANSWER_NUDGE =
  "Your previous reply was empty. Answer now from what you found above; do not mention this notice.";

const isAbort = (error: unknown): boolean =>
  (error as { name?: string } | null)?.name === "AbortError";

/** Apple's GenerationError.guardrailViolation, however the provider spells it. */
const isGuardrail = (error: unknown): boolean =>
  /guardrail|content.?filter|safety/i.test(describeError(error));

const describeError = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

const commit = async (
  input: TurnInput,
  state: MemoryState,
  exchange: { ask: string; answer: string; at: number },
  emit: (event: TraceEvent) => void,
): Promise<void> => {
  const next = await remember({
    model: input.model,
    state,
    exchange,
    summaryBudget: Math.floor(input.window / 8),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  await input.memory.save(next);
  emit({ type: "remember", summary: next.summary });
};

export { runTurn };
export type { TurnInput };
