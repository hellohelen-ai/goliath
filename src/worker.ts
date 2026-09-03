import { NoObjectGeneratedError, Output, generateText, type LanguageModel } from "ai";
import { z } from "zod";
import { summarizeToolResult } from "./compress/structural.js";
import { answerSystem, answerUser, workerSystem } from "./prompts.js";
import type { Confirm, GoliathTool, StepRecord, ToolContext } from "./types.js";

type ToolStepOutcome =
  | { ok: true; input: unknown; result: string; skipped: boolean }
  | { ok: false; reason: "tool-args-invalid" };

/**
 * A worker gets a fresh context, one tool, and a one-line brief. The conductor
 * already chose the tool, so the worker's whole job is the arguments: one
 * structured-output call, then Goliath runs the tool itself.
 *
 * Goliath never hands tools to the provider. On Apple's runtime the provider
 * would run its own loop with pre-registered tools and no step boundary
 * (docs/research/rn-providers-and-ai-sdk.md § 1.3), and mixing tools with
 * schema-constrained output suppresses tool calls on small models
 * (docs/research/small-context-agent-patterns.md, rule 9). Asking for the
 * arguments as a plain object sidesteps both, works on every provider, and
 * keeps the confirm step in Goliath's hands.
 */
const runToolStep = async (input: {
  model: LanguageModel;
  instructions: string;
  tool: GoliathTool<any, any>;
  brief: string;
  ask: string;
  confirm: Confirm;
  signal?: AbortSignal;
}): Promise<ToolStepOutcome> => {
  let args: unknown = {};
  if (needsArguments(input.tool.parameters)) {
    try {
      const result = await generateText({
        model: input.model,
        output: Output.object({ schema: input.tool.parameters }),
        system: workerSystem(input.instructions, input.brief),
        prompt: input.ask,
        ...(input.signal ? { abortSignal: input.signal } : {}),
      });
      if (result.output === undefined) return { ok: false, reason: "tool-args-invalid" };
      args = result.output;
    } catch (error) {
      // Bad JSON or a schema miss is the model's mistake; anything else is a real error.
      if (NoObjectGeneratedError.isInstance(error))
        return { ok: false, reason: "tool-args-invalid" };
      throw error;
    }
  }

  if (input.tool.writes) {
    const decision = await input.confirm({
      tool: input.tool.name,
      input: args,
      brief: input.brief,
    });
    const approved = typeof decision === "boolean" ? decision : decision.approved;
    if (!approved) {
      const reason = typeof decision === "object" && decision.reason ? `: ${decision.reason}` : "";
      // Named like deepagents' rejection message so the model reads it as a
      // decision, not an error to work around.
      return {
        ok: true,
        input: args,
        result: `declined by the user${reason}. Do not retry unless asked.`,
        skipped: true,
      };
    }
  }

  const context: ToolContext = input.signal ? { signal: input.signal } : {};
  const output = await input.tool.execute(args, context);
  const shaped = input.tool.toModelOutput
    ? input.tool.toModelOutput(output)
    : summarizeToolResult(output);
  return { ok: true, input: args, result: shaped, skipped: false };
};

/** A tool with no parameters needs no model call at all. Apple says the same: run it directly. */
const needsArguments = (schema: z.ZodType): boolean =>
  !(schema instanceof z.ZodObject) || Object.keys(schema.shape).length > 0;

/** The closing stone: turn the step log into two or three sentences. */
const runAnswerStep = async (input: {
  model: LanguageModel;
  instructions: string;
  ask: string;
  summary: string;
  steps: StepRecord[];
  /** Appended on the one retry after an empty answer. */
  nudge?: string;
  signal?: AbortSignal;
}): Promise<string> => {
  const prompt = answerUser({ ask: input.ask, summary: input.summary, steps: input.steps });
  const result = await generateText({
    model: input.model,
    system: answerSystem(input.instructions),
    prompt: input.nudge ? `${prompt}\n\n${input.nudge}` : prompt,
    ...(input.signal ? { abortSignal: input.signal } : {}),
  });
  return result.text.trim();
};

export { needsArguments, runAnswerStep, runToolStep };
export type { ToolStepOutcome };
