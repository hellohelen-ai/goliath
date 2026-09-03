import { NoObjectGeneratedError, Output, generateText, type LanguageModel } from "ai";
import { z } from "zod";
import { clip, summarizeToolResult } from "./compress/structural.js";
import { answerSystem, answerUser, bestEffortSystem, workerSystem } from "./prompts.js";
import type { Confirm, GoliathTool, StepRecord, ToolContext } from "./types.js";

type ToolStepOutcome =
  | { ok: true; input: unknown; result: string; skipped: boolean; failed?: boolean }
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
        output: Output.object({ schema: withMissing(input.tool.parameters) }),
        system: workerSystem(input.instructions, input.brief),
        prompt: input.ask,
        ...(input.signal ? { abortSignal: input.signal } : {}),
      });
      if (result.output === undefined) return { ok: false, reason: "tool-args-invalid" };
      const { missing, ...rest } = result.output as { missing?: string } & Record<string, unknown>;
      if (missing && missing.trim()) {
        // The worker said what it did not have instead of inventing it. The
        // conductor reads this like any other result and can ask the user.
        return {
          ok: true,
          input: rest,
          result: `missing: ${clip(missing.trim(), 120)}. Ask the user or use another tool.`,
          skipped: true,
        };
      }
      args = rest;
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
  let output: unknown;
  try {
    output = await input.tool.execute(args, context);
  } catch (error) {
    if ((error as { name?: string } | null)?.name === "AbortError") throw error;
    // smolagents: "Error executing tool ... Please try again or use another tool".
    // The conductor reads this and plans around it; two in a row is a real signal.
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: true,
      input: args,
      result: `error: ${clip(message, 160)}. Try different arguments or another tool.`,
      skipped: false,
      failed: true,
    };
  }
  const shaped = input.tool.toModelOutput
    ? input.tool.toModelOutput(output)
    : summarizeToolResult(output);
  return { ok: true, input: args, result: shaped, skipped: false };
};

/** A tool with no parameters needs no model call at all. Apple says the same: run it directly. */
const needsArguments = (schema: z.ZodType): boolean =>
  !(schema instanceof z.ZodObject) || Object.keys(schema.shape).length > 0;

/**
 * The tool's schema plus a trailing optional `missing`. Last, so it cannot
 * steal the argument budget; present, so a required value the brief did not
 * contain is named rather than invented (the Constraint Tax's "wrong but
 * valid" outputs are exactly invented values).
 */
const withMissing = (schema: z.ZodType): z.ZodType =>
  schema instanceof z.ZodObject
    ? schema.extend({
        missing: z
          .string()
          .optional()
          .describe("Required values the brief did not contain, if any. Otherwise leave empty."),
      })
    : schema;

/** The closing stone: turn the step log into two or three sentences. */
const runAnswerStep = async (input: {
  model: LanguageModel;
  instructions: string;
  ask: string;
  summary: string;
  steps: StepRecord[];
  /** Appended on the one retry after an empty answer. */
  nudge?: string;
  /** The loop stalled; say what was found and what is open. */
  bestEffort?: boolean;
  signal?: AbortSignal;
}): Promise<string> => {
  const prompt = answerUser({ ask: input.ask, summary: input.summary, steps: input.steps });
  const result = await generateText({
    model: input.model,
    system: input.bestEffort
      ? bestEffortSystem(input.instructions)
      : answerSystem(input.instructions),
    prompt: input.nudge ? `${prompt}\n\n${input.nudge}` : prompt,
    ...(input.signal ? { abortSignal: input.signal } : {}),
  });
  return result.text.trim();
};

export { needsArguments, runAnswerStep, runToolStep };
export type { ToolStepOutcome };
