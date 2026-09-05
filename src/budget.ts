import type { ModelMessage } from "ai";
import { GoliathBudgetError, ModelCallError } from "./errors.js";
import type { TokenCounter, TraceEvent } from "./types.js";

const PROMPT_SHARE = 0.7;

/**
 * Tokens, estimated without a tokenizer. English runs near four characters
 * per token; the margin covers code, names, and JSON, which run denser.
 */
const estimateTokens = (text: string): number => {
  // The English heuristic badly undercounts CJK and emoji. Allow one token
  // per UTF-8 byte for non-ASCII text; this is still an estimate, not a tokenizer.
  let ascii = 0;
  let nonAsciiBytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code <= 0x7f) ascii++;
    else nonAsciiBytes += code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return Math.ceil((ascii / 4) * 1.15) + nonAsciiBytes;
};

/** Clip to the same estimate used by the request guard, including the marker. */
const clipTokens = (text: string, budget: number): string => {
  if (estimateTokens(text) <= budget) return text;
  if (budget < estimateTokens("…")) return "";
  const chars = Array.from(text);
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (estimateTokens(chars.slice(0, mid).join("") + "…") <= budget) low = mid;
    else high = mid - 1;
  }
  return chars.slice(0, low).join("") + "…";
};

class ContextBudgetError extends GoliathBudgetError {}

/** Reserve output and provider framing before admitting any model request. */
const budgetPrompt = async (input: {
  label: string;
  window: number;
  maxOutputTokens: number;
  system: string;
  prompt: string;
  responseFormat?: unknown;
  compact?: () => string;
  emit?: (event: TraceEvent) => void;
  countTokens?: TokenCounter;
}): Promise<string> => {
  const reserve = Math.max(128, Math.ceil(input.window * 0.1));
  const limit = Math.min(
    Math.floor(input.window * PROMPT_SHARE),
    input.window - input.maxOutputTokens - reserve,
  );
  const count = async (prompt: string) => {
    const schema = input.responseFormat ? JSON.stringify(input.responseFormat) : "";
    let tokens: number;
    try {
      tokens = input.countTokens
        ? await input.countTokens([input.system, schema, prompt].filter(Boolean).join("\n\n"))
        : estimateTokens(input.system) + estimateTokens(schema) + estimateTokens(prompt);
      if (!Number.isSafeInteger(tokens) || tokens < 0)
        throw new Error("countTokens must return a non-negative integer");
    } catch (error) {
      if ((error as { name?: string } | null)?.name === "AbortError") throw error;
      const role =
        input.label === "conductor"
          ? "plan"
          : input.label === "worker"
            ? "arguments"
            : input.label === "scribe"
              ? "scribe"
              : "answer";
      throw new ModelCallError(role, error);
    }
    return tokens + 8;
  };
  let prompt = input.prompt;
  let tokens = await count(prompt);
  if (tokens > limit && input.compact) {
    prompt = input.compact();
    tokens = await count(prompt);
  }
  input.emit?.({
    type: "budget",
    label: input.label,
    tokens,
    limit,
    source: input.countTokens ? "tokenizer" : "estimate",
  });
  if (tokens > limit) throw new ContextBudgetError(input.label, tokens, limit);
  return prompt;
};

const textOf = (message: ModelMessage): string => {
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((part) => {
      if (part.type === "text") return part.text;
      if (part.type === "tool-call") return JSON.stringify(part.input ?? {});
      if (part.type === "tool-result") return JSON.stringify(part.output ?? "");
      return "";
    })
    .join(" ");
};

const messageTokens = (message: ModelMessage): number => estimateTokens(textOf(message)) + 4;

const transcriptTokens = (messages: ModelMessage[]): number =>
  messages.reduce((sum, message) => sum + messageTokens(message), 0);

/**
 * Drop the oldest non-system messages until the transcript fits. The first
 * message survives when it is the system prompt; the last always survives.
 */
const fitWithin = (messages: ModelMessage[], budget: number): ModelMessage[] => {
  const kept = [...messages];
  const protectedHead = kept[0]?.role === "system" ? 1 : 0;
  while (transcriptTokens(kept) > budget && kept.length > protectedHead + 1) {
    kept.splice(protectedHead, 1);
  }
  return kept;
};

export {
  budgetPrompt,
  clipTokens,
  ContextBudgetError,
  estimateTokens,
  fitWithin,
  messageTokens,
  PROMPT_SHARE,
  textOf,
  transcriptTokens,
};
