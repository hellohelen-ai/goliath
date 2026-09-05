import type { ModelMessage } from "ai";
import { GoliathBudgetError } from "./errors.js";

/**
 * Tokens, estimated without a tokenizer. English runs near four characters
 * per token; the margin covers code, names, and JSON, which run denser.
 */
const estimateTokens = (text: string): number => Math.ceil((text.length / 4) * 1.15);

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

export { estimateTokens, fitWithin, messageTokens, textOf, transcriptTokens };

/** Reserve 30% of the window for output and provider/schema overhead. */
const assertPromptBudget = (
  phase: string,
  system: string,
  prompt: string,
  window: number,
): void => {
  const tokens = estimateTokens(system) + estimateTokens(prompt);
  const limit = Math.floor(window * 0.7);
  if (tokens > limit) throw new GoliathBudgetError(phase, tokens, limit);
};
export { assertPromptBudget };
