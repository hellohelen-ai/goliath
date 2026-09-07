import { NoObjectGeneratedError, Output, generateText } from "ai";
import { z } from "zod";
import { modelCall } from "./errors.js";
import { budgetPrompt, clipTokens } from "./budget.js";
import { checkAbort, recentContext, resolveModel } from "./context.js";
import { trimSteps } from "./conductor.js";
import { clip } from "./compress/structural.js";
import { answerSystem, answerUser, bestEffortSystem, workerSystem } from "./prompts.js";
import type {
  GoliathTool,
  StepRecord,
  ModelSource,
  TokenCounter,
  Exchange,
  TraceEvent,
} from "./types.js";

type PreparedToolCall =
  { ok: true; input: unknown; missing?: string } | { ok: false; reason: "tool-args-invalid" };

/** Generate arguments in a fresh context. Execution and policy stay in the turn loop. */
const prepareToolCall = async (input: {
  model: ModelSource;
  countTokens?: TokenCounter;
  emit?: (event: TraceEvent) => void;
  instructions: string;
  tool: GoliathTool<any, any>;
  brief: string;
  ask: string;
  summary?: string;
  recent?: Exchange[];
  steps?: StepRecord[];
  window: number;
  signal?: AbortSignal;
}): Promise<PreparedToolCall> => {
  checkAbort(input.signal);
  const steps = input.steps ?? [];
  let args: unknown = {};
  if (needsArguments(input.tool.parameters)) {
    const system = workerSystem(input.instructions, input.brief);
    const output = Output.object({ schema: withMissing(input.tool.parameters) });
    const maxOutputTokens = 512;
    const prompt = await budgetPrompt({
      label: "worker",
      window: input.window,
      maxOutputTokens,
      system,
      prompt: answerUser({
        ask: input.ask,
        summary: clipTokens(input.summary ?? "", Math.floor(input.window / 8)),
        recent: recentContext(input.recent ?? [], Math.floor(input.window / 8)),
        steps: input.tool.requires?.length
          ? steps.filter((step) => input.tool.requires!.includes(step.tool ?? ""))
          : steps.slice(-1),
      }),
      responseFormat: await output.responseFormat,
      ...(input.emit ? { emit: input.emit } : {}),
      ...(input.countTokens ? { countTokens: input.countTokens } : {}),
    });
    try {
      const result = await modelCall("arguments", () =>
        generateText({
          model: resolveModel(input.model),
          output,
          maxOutputTokens,
          maxRetries: 0,
          system,
          prompt,
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

type AnswerOutcome = { ok: true; text: string; output?: unknown } | { ok: false };

/** The closing step: prose by default, or a validated structured answer with one retry. */
const runAnswerStep = async (input: {
  model: ModelSource;
  outputSchema?: z.ZodType;
  countTokens?: TokenCounter;
  instructions: string;
  ask: string;
  summary: string;
  recent?: Exchange[];
  steps: StepRecord[];
  window: number;
  emit?: (event: TraceEvent) => void;
  /** Appended on the one retry after an empty answer. */
  nudge?: string;
  /** The loop stalled; say what was found and what is open. */
  bestEffort?: boolean;
  signal?: AbortSignal;
}): Promise<AnswerOutcome> => {
  checkAbort(input.signal);
  const system = input.bestEffort
    ? bestEffortSystem(input.instructions, !!input.outputSchema)
    : answerSystem(input.instructions, !!input.outputSchema);
  const render = (steps: StepRecord[]) => {
    const base = answerUser({
      ask: input.ask,
      summary: clipTokens(input.summary, Math.floor(input.window / 8)),
      recent: recentContext(input.recent ?? [], Math.floor(input.window / 8)),
      steps,
    });
    return input.nudge ? `${base}\n\n${input.nudge}` : base;
  };
  const maxOutputTokens = 384;
  const output = input.outputSchema ? Output.object({ schema: input.outputSchema }) : undefined;
  const responseFormat = output ? await output.responseFormat : undefined;
  for (let attempt = 0; attempt < (output ? 2 : 1); attempt++) {
    checkAbort(input.signal);
    const renderAttempt = (steps: StepRecord[]) =>
      render(steps) + (attempt ? `\n\n${INVALID_ANSWER_NUDGE}` : "");
    const prompt = await budgetPrompt({
      label: "answer",
      window: input.window,
      maxOutputTokens,
      system,
      prompt: renderAttempt(input.steps),
      ...(responseFormat ? { responseFormat } : {}),
      compact: () => renderAttempt(trimSteps(input.steps)),
      ...(input.emit ? { emit: input.emit } : {}),
      ...(input.countTokens ? { countTokens: input.countTokens } : {}),
    });
    checkAbort(input.signal);
    try {
      const result = await modelCall("answer", () =>
        generateText({
          model: resolveModel(input.model),
          ...(output ? { output } : {}),
          system,
          prompt,
          maxOutputTokens,
          maxRetries: 0,
          ...(input.signal ? { abortSignal: input.signal } : {}),
        }),
      );
      // The SDK has already validated and transformed output. Do not parse it again.
      return {
        ok: true,
        text: result.text.trim(),
        ...(output ? { output: result.output } : {}),
      };
    } catch (error) {
      if (!output || !NoObjectGeneratedError.isInstance(error)) throw error;
    }
  }
  return { ok: false };
};

const INVALID_ANSWER_NUDGE =
  "Your last reply was not valid. Reply with JSON matching the supplied schema, using only the context above.";

export { needsArguments, runAnswerStep, prepareToolCall };
export type { PreparedToolCall };
