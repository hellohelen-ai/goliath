import { generateText, type LanguageModel } from "ai";
import { assertPromptBudget, estimateTokens } from "./budget.js";
import { scribeSystem, scribeUser } from "./prompts.js";
import type { Exchange, MemoryState } from "./types.js";

import { modelCall } from "./errors.js";

const RECENT_KEEP = 3;

/**
 * Remember the turn. The last few exchanges stay verbatim; when one falls off
 * the end it is folded into the brief with one model call. So most turns cost
 * nothing, and the brief never grows past its budget.
 */
const remember = async (input: {
  model: LanguageModel;
  state: MemoryState;
  exchange: Exchange;
  summaryBudget: number;
  signal?: AbortSignal;
  window?: number;
}): Promise<MemoryState> => {
  const recent = [...input.state.recent, input.exchange];
  let summary = input.state.summary;

  while (recent.length > RECENT_KEEP) {
    const evicted = recent.shift();
    if (!evicted) break;
    summary = await fold({
      model: input.model,
      summary,
      exchange: evicted,
      ...(input.window ? { window: input.window } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });
  }

  if (estimateTokens(summary) > input.summaryBudget) {
    summary = summary.slice(0, Math.floor((input.summaryBudget * 4) / 1.15));
  }

  return { summary, recent };
};

const fold = async (input: {
  model: LanguageModel;
  summary: string;
  exchange: Exchange;
  signal?: AbortSignal;
  window?: number;
}): Promise<string> => {
  const prompt = scribeUser({
    summary: input.summary,
    ask: input.exchange.ask,
    answer: input.exchange.answer,
  });
  if (input.window) assertPromptBudget("scribe", scribeSystem, prompt, input.window);
  const result = await modelCall("scribe", () =>
    generateText({
      model: input.model,
      system: scribeSystem,
      prompt,
      ...(input.signal ? { abortSignal: input.signal } : {}),
    }),
  );
  const text = result.text.trim();
  return text || input.summary;
};

export { RECENT_KEEP, remember };
