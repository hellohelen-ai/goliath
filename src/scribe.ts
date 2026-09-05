import { modelCall, ModelCallError, OperationError } from "./errors.js";
import { resolveModel } from "./context.js";
import type { ModelSource, TokenCounter } from "./types.js";
import { generateText } from "ai";
import { budgetPrompt, clipTokens } from "./budget.js";
import { scribeSystem, scribeUser, stepLog } from "./prompts.js";
import type { Exchange, MemoryState, TraceEvent } from "./types.js";

const RECENT_KEEP = 3;

/**
 * Remember the turn. The last few exchanges stay verbatim; when one falls off
 * the end it is folded into the brief with one model call. So most turns cost
 * nothing, and the brief never grows past its budget.
 */
const remember = async (input: {
  model: ModelSource;
  countTokens?: TokenCounter;
  state: MemoryState;
  exchange: Exchange;
  summaryBudget: number;
  window?: number;
  emit?: (event: TraceEvent) => void;
  /** A failed device session must not be called again to remember a cloud answer. */
  skipModel?: boolean;
  signal?: AbortSignal;
}): Promise<MemoryState> => {
  const recent = [...input.state.recent, input.exchange];
  let summary = clipTokens(input.state.summary, input.summaryBudget);
  let skipModel = input.skipModel ?? false;

  while (recent.length > RECENT_KEEP) {
    const evicted = recent.shift();
    if (!evicted) break;
    if (skipModel) continue;
    try {
      summary = clipTokens(
        await fold({
          model: input.model,
          summary,
          exchange: evicted,
          window: input.window ?? 4096,
          ...(input.emit ? { emit: input.emit } : {}),
          ...(input.countTokens ? { countTokens: input.countTokens } : {}),
          ...(input.signal ? { signal: input.signal } : {}),
        }),
        input.summaryBudget,
      );
    } catch (error) {
      if ((error as { name?: string } | null)?.name === "AbortError") throw error;
      if (error instanceof OperationError && !(error instanceof ModelCallError)) throw error;
      // Memory maintenance must never discard a completed answer or replay a turn.
      skipModel = true;
      input.emit?.({
        type: "memory-error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { summary, recent };
};

const fold = async (input: {
  model: ModelSource;
  countTokens?: TokenCounter;
  summary: string;
  exchange: Exchange;
  window: number;
  emit?: (event: TraceEvent) => void;
  signal?: AbortSignal;
}): Promise<string> => {
  const maxOutputTokens = 192;
  const prompt = await budgetPrompt({
    label: "scribe",
    window: input.window,
    maxOutputTokens,
    system: scribeSystem,
    prompt: scribeUser({
      summary: input.summary,
      ask: input.exchange.ask,
      answer: input.exchange.answer,
      actions: stepLog((input.exchange.steps ?? []).filter((step) => step.kind === "tool")),
    }),
    ...(input.emit ? { emit: input.emit } : {}),
    ...(input.countTokens ? { countTokens: input.countTokens } : {}),
  });
  const result = await modelCall("scribe", () =>
    generateText({
      model: resolveModel(input.model),
      system: scribeSystem,
      prompt,
      maxOutputTokens,
      maxRetries: 0,
      ...(input.signal ? { abortSignal: input.signal } : {}),
    }),
  );
  const text = result.text.trim();
  return text || input.summary;
};

export { RECENT_KEEP, remember };
