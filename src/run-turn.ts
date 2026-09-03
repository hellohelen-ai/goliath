import type { LanguageModel } from "ai";
import { plan, type Plan } from "./conductor.js";
import { judgeAnswer, judgeStep } from "./judge.js";
import { DEFAULT_PERSONA } from "./prompts.js";
import { remember } from "./scribe.js";
import type {
  Confirm,
  EscalationReason,
  Fallback,
  Memory,
  MemoryState,
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
  persona?: string;
  maxSteps: number;
  window: number;
  onEvent?: (event: TraceEvent) => void;
  signal?: AbortSignal;
};

/**
 * One turn, start to finish: recall, then up to `maxSteps` stones, then an
 * answer, then remember. Every escalation path goes through `escalate` so the
 * cloud always receives the same shape.
 */
const runTurn = async (input: TurnInput): Promise<RunResult> => {
  const persona = input.persona ?? DEFAULT_PERSONA;
  const trace: TraceEvent[] = [];
  const steps: StepRecord[] = [];
  const emit = (event: TraceEvent) => {
    trace.push(event);
    input.onEvent?.(event);
  };

  const state = await input.memory.load();
  emit({ type: "recall", summary: state.summary, recent: state.recent.length });

  const escalate = async (reason: EscalationReason): Promise<RunResult> => {
    emit({ type: "escalate", reason });
    if (!input.fallback) {
      return { text: "", handledBy: "device", steps, trace };
    }
    const { text } = await input.fallback({
      ask: input.ask,
      summary: state.summary,
      recent: state.recent,
      steps,
      reason,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    await commit(input, state, { ask: input.ask, answer: text, at: Date.now() }, emit);
    return { text, handledBy: "cloud", steps, trace };
  };

  const hasTools = Object.keys(input.tools).length > 0;

  for (;;) {
    const stall = judgeStep({ steps, maxSteps: input.maxSteps });
    if (stall) return escalate(stall);

    const outcome = hasTools
      ? await plan({
          model: input.model,
          persona,
          tools: input.tools,
          ask: input.ask,
          summary: state.summary,
          steps,
          maxSteps: input.maxSteps,
          ...(input.signal ? { signal: input.signal } : {}),
        })
      : { ok: true as const, plan: { kind: "answer", brief: "reply" } as Plan };

    if (!outcome.ok) return escalate("plan-invalid");
    const next = outcome.plan;
    emit({
      type: "plan",
      index: steps.length,
      kind: next.kind === "escalate" ? "answer" : next.kind,
      ...(next.tool ? { tool: next.tool } : {}),
      brief: next.brief,
    });

    if (next.kind === "escalate") return escalate("conductor-asked");

    if (next.kind === "answer") {
      const text = await runAnswerStep({
        model: input.model,
        persona,
        ask: input.ask,
        summary: state.summary,
        steps,
        ...(input.signal ? { signal: input.signal } : {}),
      });
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
    const done = await runToolStep({
      model: input.model,
      persona,
      tool,
      brief: next.brief,
      ask: input.ask,
      confirm: async (request) => {
        const approved = await input.confirm(request);
        emit({ type: "confirm", tool: request.tool, approved });
        return approved;
      },
      ...(input.signal ? { signal: input.signal } : {}),
    });

    if (done.text !== undefined) {
      // The worker answered instead of calling. Treat it as a weak answer step.
      steps.push({ index: steps.length, kind: "answer", brief: next.brief, text: done.text });
      const empty = judgeAnswer(done.text);
      if (empty) return escalate(empty);
      emit({ type: "answer", text: done.text });
      await commit(input, state, { ask: input.ask, answer: done.text, at: Date.now() }, emit);
      return { text: done.text, handledBy: "device", steps, trace };
    }

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
    });
    emit({
      type: "tool",
      tool: tool.name,
      input: done.input,
      result: done.result,
      ms: Date.now() - started,
    });
  }
};

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
