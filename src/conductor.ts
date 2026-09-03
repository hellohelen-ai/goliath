import { Output, generateText, type LanguageModel } from "ai";
import { z } from "zod";
import { estimateTokens } from "./budget.js";
import { clip } from "./compress/structural.js";
import { conductorSystem, conductorUser } from "./prompts.js";
import type { StepRecord, ToolMap, TraceEvent } from "./types.js";

/**
 * The next stone. Flat on purpose: three fields is what a 3B model fills in
 * reliably under constrained decoding.
 */
const planSchema = z.object({
  kind: z.enum(["tool", "answer", "escalate"]),
  tool: z.string().optional(),
  brief: z.string(),
});

type Plan = z.infer<typeof planSchema>;

type PlanOutcome =
  { ok: true; plan: Plan } | { ok: false; reason: "plan-invalid" | "no-such-tool" };

/**
 * Apple's window is input plus output, and the overflow error kills the
 * session, so the conductor's prompt must stay well under it. Past this share
 * of the window, older step results are clipped to a line before prompting.
 */
const PROMPT_SHARE = 0.7;
const CLIPPED_RESULT_CHARS = 100;

const trimSteps = (steps: StepRecord[]): StepRecord[] =>
  steps.map((step, i) =>
    step.kind === "tool" && step.result && i < steps.length - 1
      ? { ...step, result: clip(step.result.split("\n")[0] ?? "", CLIPPED_RESULT_CHARS) }
      : step,
  );

/** Ask the model what to do next, with only the ask, the brief, and the step log in view. */
const plan = async (input: {
  model: LanguageModel;
  persona: string;
  tools: ToolMap;
  ask: string;
  summary: string;
  steps: StepRecord[];
  maxSteps: number;
  window: number;
  emit?: (event: TraceEvent) => void;
  signal?: AbortSignal;
}): Promise<PlanOutcome> => {
  const toolNames = Object.keys(input.tools);
  const system = conductorSystem(input.persona, input.tools, input.maxSteps);
  const limit = Math.floor(input.window * PROMPT_SHARE);
  let steps = input.steps;
  let prompt = conductorUser({ ask: input.ask, summary: input.summary, steps });
  let tokens = estimateTokens(system) + estimateTokens(prompt);
  if (tokens > limit) {
    steps = trimSteps(steps);
    prompt = conductorUser({ ask: input.ask, summary: input.summary, steps });
    tokens = estimateTokens(system) + estimateTokens(prompt);
    input.emit?.({ type: "budget", label: "conductor", tokens, limit });
  }
  try {
    const result = await generateText({
      model: input.model,
      output: Output.object({ schema: planSchema }),
      system,
      prompt,
      ...(input.signal ? { abortSignal: input.signal } : {}),
    });
    const next = result.output;
    if (!next) return { ok: false, reason: "plan-invalid" };
    if (next.kind === "tool" && (!next.tool || !toolNames.includes(next.tool))) {
      return { ok: false, reason: "no-such-tool" };
    }
    return { ok: true, plan: next };
  } catch (error) {
    if ((error as { name?: string } | null)?.name === "AbortError") throw error;
    return { ok: false, reason: "plan-invalid" };
  }
};

export { plan, planSchema, trimSteps, PROMPT_SHARE };
export type { Plan, PlanOutcome };
