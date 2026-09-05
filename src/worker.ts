import { checkAbort, recentContext, resolveModel, snapshot } from "./context.js";
import { isRepeat } from "./judge.js";
import type { ModelSource, TokenCounter } from "./types.js";
import { NoObjectGeneratedError, Output, generateText } from "ai";
import { z } from "zod";
import { budgetPrompt, clipTokens } from "./budget.js";
import { trimSteps } from "./conductor.js";
import { clip, summarizeToolResult } from "./compress/structural.js";
import { answerSystem, answerUser, bestEffortSystem, workerSystem } from "./prompts.js";
import type {
  Confirm,
  Exchange,
  GoliathTool,
  StepRecord,
  ToolContext,
  TraceEvent,
} from "./types.js";

type ToolStepOutcome =
  | {
      ok: true;
      input: unknown;
      result: string;
      skipped: boolean;
      failed?: boolean;
      cached?: boolean;
      output?: unknown;
    }
  | { ok: false; reason: "tool-args-invalid" | "repeated-tool-call" | "tool-prerequisite-missing" };

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
  model: ModelSource;
  countTokens?: TokenCounter;
  instructions: string;
  tool: GoliathTool<any, any>;
  brief: string;
  ask: string;
  summary?: string;
  recent?: Exchange[];
  steps?: StepRecord[];
  confirm: Confirm;
  window: number;
  emit?: (event: TraceEvent) => void;
  signal?: AbortSignal;
}): Promise<ToolStepOutcome> => {
  checkAbort(input.signal);
  const steps = input.steps ?? [];
  if (
    input.tool.requires?.some(
      (name) => !steps.some((step) => step.tool === name && !step.failed && !step.skipped),
    )
  ) {
    return { ok: false, reason: "tool-prerequisite-missing" };
  }
  const context: ToolContext = {
    ...(input.signal ? { signal: input.signal } : {}),
    steps: snapshot(steps) ?? [],
    recent: snapshot(input.recent ?? []) ?? [],
  };
  let args: unknown = {};
  if (needsArguments(input.tool.parameters)) {
    try {
      const output = Output.object({ schema: withMissing(input.tool.parameters) });
      const system = workerSystem(input.instructions, input.brief);
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
      const result = await generateText({
        model: resolveModel(input.model),
        output,
        system,
        prompt,
        maxOutputTokens,
        maxRetries: 0,
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

  checkAbort(input.signal);
  if (input.tool.resolveInput) {
    try {
      args = await input.tool.resolveInput(args, context);
      const parsed = await input.tool.parameters.safeParseAsync(args);
      if (!parsed.success) return { ok: false, reason: "tool-args-invalid" };
      args = parsed.data;
    } catch (error) {
      if ((error as { name?: string } | null)?.name === "AbortError") throw error;
      return { ok: false, reason: "tool-args-invalid" };
    }
  }
  checkAbort(input.signal);
  const previous = [...steps]
    .reverse()
    .find((step) => isRepeat([step], { tool: input.tool.name, input: args }));
  const readInvalidated =
    previous &&
    !input.tool.writes &&
    steps.some((step) => step.index > previous.index && step.writes && !step.skipped);
  if (previous && !readInvalidated) {
    if (!input.tool.writes && !previous.cached && !previous.failed && !previous.skipped) {
      return {
        ok: true,
        input: args,
        result: `same as step ${previous.index + 1}`,
        skipped: false,
        cached: true,
        output: previous.output,
      };
    }
    return { ok: false, reason: "repeated-tool-call" };
  }
  // Preserve what was approved even if a tool mutates its argument object.
  const recordedInput = snapshot(args);

  if (input.tool.writes) {
    const decision = await input.confirm({
      tool: input.tool.name,
      input: snapshot(args),
      brief: input.brief,
    });
    const approved = typeof decision === "boolean" ? decision : decision.approved;
    if (!approved) {
      const reason = typeof decision === "object" && decision.reason ? `: ${decision.reason}` : "";
      // Named like deepagents' rejection message so the model reads it as a
      // decision, not an error to work around.
      return {
        ok: true,
        input: recordedInput,
        result: `declined by the user${reason}. Do not retry unless asked.`,
        skipped: true,
      };
    }
  }

  checkAbort(input.signal);
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
      input: recordedInput,
      result: `error: ${clip(message, 160)}. Try different arguments or another tool.`,
      skipped: false,
      failed: true,
    };
  }
  const recordedOutput = snapshot(output);
  let shaped: string;
  try {
    shaped = input.tool.toModelOutput
      ? input.tool.toModelOutput(output)
      : summarizeToolResult(output);
  } catch {
    // Formatting must not erase the record of an action that already happened.
    shaped = "completed (result could not be summarized)";
  }
  return {
    ok: true,
    input: recordedInput,
    result: clip(shaped, 600),
    skipped: false,
    output: recordedOutput,
  };
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
  model: ModelSource;
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
}): Promise<string> => {
  checkAbort(input.signal);
  const system = input.bestEffort
    ? bestEffortSystem(input.instructions)
    : answerSystem(input.instructions);
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
  const prompt = await budgetPrompt({
    label: "answer",
    window: input.window,
    maxOutputTokens,
    system,
    prompt: render(input.steps),
    compact: () => render(trimSteps(input.steps)),
    ...(input.emit ? { emit: input.emit } : {}),
    ...(input.countTokens ? { countTokens: input.countTokens } : {}),
  });
  const result = await generateText({
    model: resolveModel(input.model),
    system,
    prompt,
    maxOutputTokens,
    maxRetries: 0,
    ...(input.signal ? { abortSignal: input.signal } : {}),
  });
  return result.text.trim();
};

export { needsArguments, runAnswerStep, runToolStep };
export type { ToolStepOutcome };
