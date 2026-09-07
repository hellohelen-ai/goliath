import { estimateTokens } from "./budget.js";
import type { StepRecord, TokenCounter } from "./types.js";

export type ResultBudget = { maxTokens: number; countTokens?: TokenCounter };
export type ContentBudgets = { toolResultTokens?: number; retrievedContextTokens?: number };

export function contentBudgets(window: number, options: ContentBudgets = {}) {
  const result = {
    toolResultTokens:
      options.toolResultTokens ?? Math.max(1, Math.min(800, Math.floor(window / 8))),
    retrievedContextTokens:
      options.retrievedContextTokens ?? Math.max(1, Math.min(2000, Math.floor(window / 4))),
  };
  for (const value of Object.values(result))
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error("Content budgets must be positive integer token counts.");
  if (result.toolResultTokens > result.retrievedContextTokens)
    throw new Error("toolResultTokens must fit within retrievedContextTokens.");
  return result;
}

export async function countResult(text: string, budget: ResultBudget): Promise<number> {
  const count = await (budget.countTokens ?? estimateTokens)(text);
  if (!Number.isSafeInteger(count) || count < 0)
    throw new Error("countTokens must return a non-negative integer.");
  return count;
}

/** Return a Unicode-safe prefix length whose complete formatted output fits. */
export async function fitPrefix(
  text: string,
  render: (prefix: string) => string,
  budget: ResultBudget,
): Promise<number> {
  const chars = Array.from(text);
  let low = 0,
    high = chars.length;
  if ((await countResult(render(""), budget)) > budget.maxTokens)
    throw new Error("Tool result budget is too small for pagination metadata.");
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((await countResult(render(chars.slice(0, middle).join("")), budget)) <= budget.maxTokens)
      low = middle;
    else high = middle - 1;
  }
  return chars.slice(0, low).join("").length;
}

export async function fitResult(text: string, budget: ResultBudget): Promise<string> {
  if ((await countResult(text, budget)) <= budget.maxTokens) return text;
  const length = await fitPrefix(text, (prefix) => prefix + "\n[excerpt truncated]", budget);
  return text.slice(0, length) + "\n[excerpt truncated]";
}

/** Project retrieval for model prompts only. The application retains every excerpt. */
export async function retrievedSteps(
  steps: StepRecord[],
  budget: ResultBudget,
): Promise<StepRecord[]> {
  let remaining = budget.maxTokens;
  const projected = [...steps];
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i]!;
    if (step.outputMode !== "content" || !step.result) continue;
    const tokens = await countResult(step.result, budget);
    if (tokens <= remaining) remaining -= tokens;
    else
      projected[i] = {
        ...step,
        result: "(earlier excerpt omitted; read the file again if needed)",
      };
  }
  return projected;
}
