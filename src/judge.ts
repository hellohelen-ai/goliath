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
      JSON.stringify(step.input ?? null) === JSON.stringify(candidate.input ?? null),
  );

const judgeStep = (input: {
  steps: StepRecord[];
  maxSteps: number;
  next?: { tool: string; input: unknown };
}): EscalationReason | null => {
  if (input.steps.length >= input.maxSteps) return "too-many-steps";
  if (input.next && isRepeat(input.steps, input.next)) return "repeated-tool-call";
  return null;
};

const judgeAnswer = (text: string): EscalationReason | null =>
  text.trim().length === 0 ? "empty-answer" : null;

export { isRepeat, judgeAnswer, judgeStep };
