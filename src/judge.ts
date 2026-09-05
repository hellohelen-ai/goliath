import type { EscalationReason, StepRecord } from "./types.js";

/**
 * Stall detection without logprobs. A small model that is lost repeats
 * itself, so the same tool with the same arguments twice is the signal.
 */
const isRepeat = (steps: StepRecord[], candidate: { tool: string; input: unknown }): boolean =>
  steps.some(
    (step) =>
      step.kind === "tool" &&
      step.tool === candidate.tool &&
      canonical(step.input ?? null) === canonical(candidate.input ?? null),
  );

/** Object insertion order must not let an identical write bypass the duplicate check. */
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
};

const judgeStep = (input: {
  steps: StepRecord[];
  maxSteps: number;
  next?: { tool: string; input: unknown };
}): EscalationReason | null => {
  if (input.steps.length >= input.maxSteps) return "too-many-steps";
  if (input.next && isRepeat(input.steps, input.next)) return "repeated-tool-call";
  return null;
};

/** Two failed tool steps in a row: the model is not planning around the error. */
const judgeToolFailures = (steps: StepRecord[]): EscalationReason | null => {
  const last = steps.at(-1);
  const before = steps.at(-2);
  return last?.failed && before?.failed ? "tool-error" : null;
};

const judgeAnswer = (text: string): EscalationReason | null =>
  text.trim().length === 0 ? "empty-answer" : null;

export { isRepeat, judgeAnswer, judgeStep, judgeToolFailures };
