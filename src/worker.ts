import { NoObjectGeneratedError, Output, generateText, type LanguageModel } from "ai";
import { z } from "zod";
import { modelCall } from "./errors.js";
import { assertPromptBudget } from "./budget.js";
import { clip } from "./compress/structural.js";
import { answerSystem, answerUser, bestEffortSystem, workerSystem } from "./prompts.js";
import type { GoliathTool, StepRecord } from "./types.js";

type PreparedToolCall =
  { ok: true; input: unknown; missing?: string } | { ok: false; reason: "tool-args-invalid" };

/** Generate arguments in a fresh context. Execution and policy stay in the turn loop. */
const prepareToolCall = async (input: {
  model: LanguageModel;
  instructions: string;
  tool: GoliathTool<any, any>;
  brief: string;
  ask: string;
  window?: number;
  signal?: AbortSignal;
}): Promise<PreparedToolCall> => {
  let args: unknown = {};
  if (needsArguments(input.tool.parameters)) {
    const system = workerSystem(input.instructions, input.brief);
    if (input.window) assertPromptBudget("arguments", system, input.ask, input.window);
    try {
      const result = await modelCall("arguments", () =>
        generateText({
          model: input.model,
          output: Output.object({ schema: withMissing(input.tool.parameters) }),
          system,
          prompt: input.ask,
          ...(input.signal ? { abortSignal: input.signal } : {}),
        }),
      );
      if (result.output === undefined) return { ok: false, reason: "tool-args-invalid" };
      if (input.tool.parameters instanceof z.ZodObject) {
        const { missing, ...rest } = result.output as { missing?: string } & Record<
          string,
          unknown
        >;
        if (missing && missing.trim())
          return { ok: true, input: rest, missing: clip(missing.trim(), 120) };
        args = rest;
      } else args = result.output;
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error))
        return { ok: false, reason: "tool-args-invalid" };
      throw error;
    }
    // Output.object already validated and transformed the generated arguments.
    // Parsing that output again would apply non-idempotent transforms twice.
    return { ok: true, input: args };
  }
  // No model call means no SDK validation; validate the empty input here once.
  const parsed = await input.tool.parameters.safeParseAsync(args);
  return parsed.success
    ? { ok: true, input: parsed.data }
    : { ok: false, reason: "tool-args-invalid" };
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
  window?: number;
  signal?: AbortSignal;
}): Promise<string> => {
  const prompt = answerUser({ ask: input.ask, summary: input.summary, steps: input.steps });
  const system = input.bestEffort
    ? bestEffortSystem(input.instructions)
    : answerSystem(input.instructions);
  const finalPrompt = input.nudge ? `${prompt}\n\n${input.nudge}` : prompt;
  if (input.window) assertPromptBudget("answer", system, finalPrompt, input.window);
  const result = await modelCall("answer", () =>
    generateText({
      model: input.model,
      system,
      prompt: finalPrompt,
      ...(input.signal ? { abortSignal: input.signal } : {}),
    }),
  );
  return result.text.trim();
};

export { needsArguments, runAnswerStep, prepareToolCall };
export type { PreparedToolCall };
