import { NoObjectGeneratedError, Output, generateText, type LanguageModel } from "ai";
import { z } from "zod";
import { modelCall } from "./errors.js";
import { assertPromptBudget, estimateTokens } from "./budget.js";
import { clip } from "./compress/structural.js";
import { conductorSystem, conductorUser } from "./prompts.js";
import type { PlanExample, StepRecord, ToolMap, TraceEvent } from "./types.js";

/**
 * The next stone. Flat on purpose: three fields is what a 3B model fills in
 * reliably under constrained decoding.
 */
/**
 * Field order is generation order under guided generation, so `why` comes
 * first: a rationale before the decision is worth ~10 points at this model
 * size (docs/research/round2/small-model-prompting.md § 2.1). It is one
 * short sentence naming the fact that decides the step, not deliberation.
 */
const WHY = "One short sentence naming the fact that decides this step.";

const planSchema = z.object({
  why: z.string().optional().describe(WHY),
  kind: z.enum(["tool", "answer", "escalate"]),
  tool: z.string().optional(),
  brief: z.string(),
});

type Plan = z.infer<typeof planSchema>;

/**
 * The same shape with `tool` as an enum of the registered names. Under
 * constrained decoding an enum cannot be misspelled or invented (Apple's
 * guarantee only holds when the name is in the schema).
 */
const planSchemaFor = (toolNames: string[]) =>
  toolNames.length
    ? z.object({
        why: z.string().optional().describe(WHY),
        kind: z.enum(["tool", "answer", "escalate"]),
        tool: z.enum(toolNames as [string, ...string[]]).optional(),
        brief: z.string(),
      })
    : planSchema;

type PlanOutcome =
  { ok: true; plan: Plan } | { ok: false; reason: "plan-invalid" | "no-such-tool"; hint: string };

const planInvalidHint = (toolNames: string[]): string =>
  toolNames.length
    ? `Your last reply was not valid. Reply with JSON fields kind, tool, brief. tool must be one of: ${toolNames.join(", ")}, or leave it out and answer.`
    : "Your last reply was not valid. Reply with JSON fields kind, tool, brief.";

const noSuchToolHint = (name: string | undefined, toolNames: string[]): string =>
  `No such tool available: ${name ?? "(none)"}. Pick one of: ${toolNames.join(", ")}, or answer.`;

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
  instructions: string;
  tools: ToolMap;
  ask: string;
  summary: string;
  steps: StepRecord[];
  maxSteps: number;
  window: number;
  emit?: (event: TraceEvent) => void;
  /** Why the previous plan was rejected, fed back on the one retry. */
  retryHint?: string;
  facts?: Record<string, string>;
  examples?: PlanExample[];
  signal?: AbortSignal;
  strictBudget?: boolean;
}): Promise<PlanOutcome> => {
  const toolNames = Object.keys(input.tools);
  const system = conductorSystem(input.instructions, input.tools, input.maxSteps, {
    ...(input.facts ? { facts: input.facts } : {}),
    ...(input.examples ? { examples: input.examples } : {}),
  });
  const limit = Math.floor(input.window * PROMPT_SHARE);
  let steps = input.steps;
  const render = (log: StepRecord[]) => {
    const base = conductorUser({
      ask: input.ask,
      summary: input.summary,
      steps: log,
      maxSteps: input.maxSteps,
    });
    return input.retryHint ? `${base}\n\n${input.retryHint}` : base;
  };
  let prompt = render(steps);
  let tokens = estimateTokens(system) + estimateTokens(prompt);
  if (tokens > limit) {
    steps = trimSteps(steps);
    prompt = render(steps);
    tokens = estimateTokens(system) + estimateTokens(prompt);
    input.emit?.({ type: "budget", label: "conductor", tokens, limit });
  }
  if (input.strictBudget) assertPromptBudget("plan", system, prompt, input.window);
  try {
    const result = await modelCall("plan", () =>
      generateText({
        model: input.model,
        output: Output.object({ schema: planSchemaFor(toolNames) }),
        system,
        prompt,
        ...(input.signal ? { abortSignal: input.signal } : {}),
      }),
    );
    const next = result.output;
    if (!next) return { ok: false, reason: "plan-invalid", hint: planInvalidHint(toolNames) };
    if (next.kind === "tool" && (!next.tool || !toolNames.includes(next.tool))) {
      return { ok: false, reason: "no-such-tool", hint: noSuchToolHint(next.tool, toolNames) };
    }
    return { ok: true, plan: next };
  } catch (error) {
    // Only a malformed plan is the model's mistake to retry. Guardrails, a dead
    // session, or an unavailable model propagate so the turn escalates as model-error.
    if (NoObjectGeneratedError.isInstance(error)) {
      return { ok: false, reason: "plan-invalid", hint: planInvalidHint(toolNames) };
    }
    throw error;
  }
};

export { plan, planSchema, planSchemaFor, trimSteps, PROMPT_SHARE };
export type { Plan, PlanOutcome };
