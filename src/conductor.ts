import { Output, generateText, type LanguageModel } from "ai";
import { z } from "zod";
import { conductorSystem, conductorUser } from "./prompts.js";
import type { StepRecord, ToolMap } from "./types.js";

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

/** Ask the model what to do next, with only the ask, the brief, and the step log in view. */
const plan = async (input: {
  model: LanguageModel;
  persona: string;
  tools: ToolMap;
  ask: string;
  summary: string;
  steps: StepRecord[];
  maxSteps: number;
  signal?: AbortSignal;
}): Promise<PlanOutcome> => {
  const toolNames = Object.keys(input.tools);
  try {
    const result = await generateText({
      model: input.model,
      output: Output.object({ schema: planSchema }),
      system: conductorSystem(input.persona, input.tools, input.maxSteps),
      prompt: conductorUser({ ask: input.ask, summary: input.summary, steps: input.steps }),
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

export { plan, planSchema };
export type { Plan, PlanOutcome };
