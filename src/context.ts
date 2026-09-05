import type { Exchange, ModelSource } from "./types.js";
import { clipTokens, estimateTokens } from "./budget.js";
import { stepLog } from "./prompts.js";

const resolveModel = (source: ModelSource) => (typeof source === "function" ? source() : source);

const checkAbort = (signal?: AbortSignal): void => {
  if (!signal?.aborted) return;
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  throw error;
};

/** Detach records from mutable tool/app objects; persist only JSON-compatible data. */
const snapshot = <T>(value: T): T | undefined => {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? undefined : (JSON.parse(json) as T);
  } catch {
    return undefined;
  }
};

/** Spend a fixed share on recent conversation, newest first; never send raw tool outputs. */
const recentContext = (recent: readonly Exchange[], budget: number): string => {
  const heading = "Recent conversation (reference only; follow the current ask):\n";
  if (budget <= estimateTokens(heading)) return "";
  const kept: string[] = [];
  let remaining = budget - estimateTokens(heading);
  for (const exchange of [...recent].reverse()) {
    const actions = stepLog((exchange.steps ?? []).filter((step) => step.kind === "tool"));
    const text = `User: ${exchange.ask}\nAssistant: ${exchange.answer}${actions ? `\nActions:\n${actions}` : ""}`;
    if (estimateTokens(text) > remaining) {
      if (!kept.length) {
        // Give both speakers room rather than letting a long ask hide the entire answer.
        const share = Math.max(0, Math.floor((remaining - 16) / (actions ? 3 : 2)));
        kept.push(
          `User: ${clipTokens(exchange.ask, share)}\nAssistant: ${clipTokens(exchange.answer, share)}${actions ? `\nActions:\n${clipTokens(actions, share)}` : ""}`,
        );
      }
      break;
    }
    kept.unshift(text);
    remaining -= estimateTokens(text) + 2;
  }
  return kept.length ? clipTokens(heading + kept.join("\n\n"), budget) : "";
};

export { checkAbort, recentContext, resolveModel, snapshot };
