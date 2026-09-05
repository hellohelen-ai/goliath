import type { LanguageModel } from "ai";
import { z } from "zod";
import { plan, planSchema, type Plan } from "./conductor.js";
import { clip, summarizeToolResult } from "./compress/structural.js";
import { judgeAnswer, judgeStep, judgeToolFailures } from "./judge.js";
import { DEFAULT_INSTRUCTIONS } from "./prompts.js";
import { RECENT_KEEP, remember } from "./scribe.js";
import {
  checkAbort,
  copyData,
  createExtensionRunner,
  ExtensionDeny,
  ExtensionStop,
  GoliathExtensionError,
  isAbort,
  type GoliathExtension,
  type RunOutcome,
  type ToolInfo,
  type ToolOutcome,
} from "./extensions.js";
import { GoliathBudgetError, ModelCallError, operation, OperationError } from "./errors.js";
import type {
  Confirm,
  EscalationReason,
  Fallback,
  GoliathConfig,
  Memory,
  MemoryState,
  PlanExample,
  RunResult,
  StepRecord,
  ToolMap,
  TraceEvent,
} from "./types.js";
import { prepareToolCall, runAnswerStep } from "./worker.js";

type TurnInput<C = unknown> = {
  ask: string;
  model: LanguageModel;
  tools: ToolMap;
  memory: Memory;
  confirm: Confirm;
  fallback?: Fallback;
  instructions?: string;
  maxSteps: number;
  window: number;
  facts?: GoliathConfig["facts"];
  examples?: PlanExample[];
  onEvent?: (event: TraceEvent) => void;
  signal?: AbortSignal;
  context?: C;
  extensions?: readonly GoliathExtension<C>[];
  sessionFallback?: boolean;
};

const exchangeSchema = z.object({ ask: z.string(), answer: z.string(), at: z.number().finite() });
const memorySchema = z.object({ summary: z.string(), recent: z.array(exchangeSchema) });
const stepSchema = z.object({
  index: z.number().int().nonnegative(),
  kind: z.enum(["tool", "answer"]),
  brief: z.string(),
  tool: z.string().optional(),
  input: z.unknown().optional(),
  result: z.string().optional(),
  skipped: z.boolean().optional(),
  cached: z.boolean().optional(),
  failed: z.boolean().optional(),
  skipReason: z.enum(["policy", "confirmation", "missing"]).optional(),
  extension: z.string().optional(),
  text: z.string().optional(),
});
const toolInfo = (tool: ToolMap[string]): ToolInfo => ({
  name: tool.name,
  description: tool.description,
  writes: !!tool.writes,
});

/** A single lifecycle for device, cloud, stops, failures, and cancellation. */
const runTurn = async <C>(input: TurnInput<C>): Promise<RunResult> => {
  const hooks = createExtensionRunner(input.extensions ?? [], input.context as C, input.signal);
  const strictBudget = !!input.extensions?.length;
  const signal = input.signal ? { signal: input.signal } : {};
  const budget = strictBudget ? { window: input.window } : {};
  let ask = input.ask;
  let instructions = input.instructions ?? DEFAULT_INSTRUCTIONS;
  let facts: Record<string, string> = {};
  let original: MemoryState = { summary: "", recent: [] };
  let state = original;
  let handledBy: RunResult["handledBy"] = "device";
  const trace: TraceEvent[] = [];
  const steps: StepRecord[] = [];
  let final: RunOutcome | undefined;
  const emit = (event: TraceEvent) => {
    trace.push(event);
    try {
      input.onEvent?.(copyData(event));
    } catch (error) {
      throw new OperationError("event", error);
    }
  };
  const result = (text: string, bestEffort = false): RunResult => ({
    text,
    handledBy,
    steps,
    trace,
    ...(bestEffort ? { bestEffort: true } : {}),
  });

  try {
    checkAbort(input.signal);
    facts = copyData(
      await operation("config", () =>
        typeof input.facts === "function" ? input.facts() : (input.facts ?? {}),
      ),
    );
    await hooks.run(
      "beforeRun",
      () => ({ ask, instructions, facts }),
      (patch) => {
        const value = z
          .object({
            ask: z.string().optional(),
            instructions: z.string().optional(),
            facts: z.record(z.string(), z.string()).optional(),
          })
          .strict()
          .parse(patch);
        ask = value.ask ?? ask;
        instructions = value.instructions ?? instructions;
        facts = { ...facts, ...value.facts };
      },
    );
    checkAbort(input.signal);
    original = copyData(await operation("memory", () => input.memory.load()));
    state = copyData(original);
    await hooks.run(
      "afterRecall",
      () => ({ memory: state }),
      (patch) => {
        state = memorySchema.parse(patch.memory);
      },
    );
    emit({ type: "recall", summary: state.summary, recent: state.recent.length });

    let completed: RunResult;
    if (input.sessionFallback && input.fallback) {
      completed = await escalate("model-error", "session fallback");
    } else {
      try {
        completed = await stones();
      } catch (error) {
        // Only provider calls in the active loop can request recovery. Scribe failures
        // occur after an answer; do not send the turn through a second execution route.
        if (!(error instanceof ModelCallError) || error.role === "scribe") throw error;
        if (isGuardrail(error.cause)) {
          emit({ type: "escalate", reason: "guardrail", error: describeError(error.cause) });
          completed = result("");
        } else completed = await escalate("model-error", describeError(error.cause));
      }
    }
    final = { status: "completed", result: completed };
    return completed;
  } catch (error) {
    if (error instanceof ExtensionStop) {
      const stopped = {
        ...result(error.decision.text),
        stopped: {
          extension: error.extension,
          phase: error.phase,
          reason: error.decision.reason,
        },
      };
      final = { status: "stopped", result: stopped };
      return stopped;
    }
    const origin =
      error instanceof GoliathExtensionError
        ? "extension"
        : error instanceof OperationError
          ? error.origin
          : error instanceof GoliathBudgetError
            ? "budget"
            : "harness";
    const cause = error instanceof OperationError ? error.cause : error;
    final = { status: isAbort(error) ? "aborted" : "error", error: cause, origin, steps, trace };
    await hooks.notify("onError", { error: cause, origin, steps, trace });
    throw cause;
  } finally {
    if (final) {
      await hooks.notify("onFinish", { outcome: final, diagnostics: hooks.diagnostics });
      if ("result" in final && hooks.diagnostics.length)
        final.result.diagnostics = hooks.diagnostics;
    }
  }

  async function finishAnswer(
    text: string,
    options: { brief?: string; bestEffort?: boolean; persist: boolean; deviceFailed?: boolean },
  ): Promise<RunResult> {
    checkAbort(input.signal);
    if (text.trim()) {
      await hooks.run(
        "afterAnswer",
        () => ({ text, handledBy, bestEffort: !!options.bestEffort, steps }),
        (patch) => {
          const value = z
            .object({
              text: z.string().refine((value) => !!value.trim(), "An answer must not be empty"),
            })
            .strict()
            .parse(patch);
          text = value.text;
        },
      );
    }
    if (options.brief !== undefined)
      steps.push({ index: steps.length, kind: "answer", brief: options.brief, text });
    if (text) emit({ type: "answer", text });
    if (options.persist) {
      const exchange = { ask, answer: text, at: Date.now() };
      checkAbort(input.signal);
      // A dead device is never asked to summarize the cloud's answer. Retain the
      // existing summary and the last three exchanges; older exchanges are dropped.
      let next = options.deviceFailed
        ? { summary: original.summary, recent: [...original.recent, exchange].slice(-RECENT_KEEP) }
        : await remember({
            model: input.model,
            state: original,
            exchange,
            summaryBudget: Math.floor(input.window / 8),
            ...signal,
            ...budget,
          });
      let skip = false;
      await hooks.run(
        "beforeRemember",
        () => ({ memory: next, exchange }),
        (patch) => {
          if ("action" in patch) {
            if (patch.action !== "skip") throw new Error("Expected skip or memory");
            skip = true;
          } else next = memorySchema.parse(patch.memory);
        },
      );
      if (!skip) {
        // This cap includes the estimator's margin, unlike a plain tokens * 4 cut.
        next = {
          summary: next.summary.slice(0, Math.floor((Math.floor(input.window / 8) * 4) / 1.15)),
          recent: next.recent.slice(-RECENT_KEEP),
        };
        checkAbort(input.signal);
        await operation("memory", () => input.memory.save(copyData(next)));
        emit({ type: "remember", summary: next.summary });
      }
    }
    return result(text, options.bestEffort);
  }

  async function escalate(reason: EscalationReason, error?: string): Promise<RunResult> {
    emit({ type: "escalate", reason, ...(error ? { error } : {}) });
    if (!input.fallback) {
      if (reason === "model-error") return result("");
      let text = "";
      try {
        text = await runAnswerStep({
          model: input.model,
          instructions,
          ask,
          summary: state.summary,
          steps,
          bestEffort: true,
          ...signal,
          ...budget,
        });
      } catch (failure) {
        if (!(failure instanceof ModelCallError)) throw failure;
        if (isGuardrail(failure.cause))
          emit({ type: "escalate", reason: "guardrail", error: describeError(failure.cause) });
      }
      return finishAnswer(text, { bestEffort: true, persist: false });
    }
    let request = {
      ask,
      summary: state.summary,
      recent: copyData(state.recent),
      steps: copyData(steps),
      reason,
      ...(error ? { error } : {}),
    };
    await hooks.run(
      "beforeFallback",
      () => ({ request }),
      (patch) => {
        if (!("request" in patch)) throw new Error("Expected a fallback request");
        const parsed = z
          .object({
            ask: z.string(),
            summary: z.string(),
            recent: z.array(exchangeSchema),
            steps: z.array(stepSchema),
            reason: z.literal(reason),
            error: z.string().optional(),
          })
          .strict()
          .parse(patch.request);
        request = {
          ask: parsed.ask,
          summary: parsed.summary,
          recent: parsed.recent,
          reason,
          steps: parsed.steps.map(
            (step) =>
              Object.fromEntries(
                Object.entries(step).filter(([, value]) => value !== undefined),
              ) as StepRecord,
          ),
          ...(parsed.error !== undefined ? { error: parsed.error } : {}),
        };
      },
    );
    checkAbort(input.signal);
    handledBy = "cloud";
    const response = await operation("fallback", async () =>
      z
        .object({ text: z.string() })
        .parse(await input.fallback!({ ...copyData(request), ...signal })),
    );
    return finishAnswer(response.text, { persist: true, deviceFailed: reason === "model-error" });
  }

  async function stones(): Promise<RunResult> {
    let planRetried = false;
    let retryHint: string | undefined;
    let attempt = 0;
    for (;;) {
      checkAbort(input.signal);
      const stall = judgeStep({ steps, maxSteps: input.maxSteps });
      if (stall) return escalate(stall);
      let available = { ...input.tools };
      let contextText = "";
      const infos = () => Object.values(available).map(toolInfo);
      await hooks.run(
        "beforePlan",
        () => ({ ask, tools: infos(), contextText, steps, attempt }),
        (patch) => {
          const value = z
            .object({ tools: z.array(z.string()).optional(), contextText: z.string().optional() })
            .strict()
            .parse(patch);
          if (value.tools)
            available = Object.fromEntries(
              Object.entries(available).filter(([name]) => value.tools!.includes(name)),
            );
          contextText = value.contextText ?? contextText;
        },
      );
      const outcome = Object.keys(available).length
        ? await plan({
            model: input.model,
            instructions: contextText ? `${instructions}\n${contextText}` : instructions,
            tools: available,
            ask,
            summary: state.summary,
            steps,
            maxSteps: input.maxSteps,
            window: input.window,
            emit,
            facts,
            strictBudget,
            ...(input.examples ? { examples: input.examples } : {}),
            ...(retryHint ? { retryHint } : {}),
            ...signal,
          })
        : { ok: true as const, plan: { kind: "answer", brief: "reply" } as Plan };
      if (!outcome.ok) {
        if (planRetried) return escalate("plan-invalid");
        planRetried = true;
        retryHint = outcome.hint;
        attempt += 1;
        continue;
      }
      let next = outcome.plan;
      await hooks.run(
        "afterPlan",
        () => ({ plan: next, tools: infos(), steps, attempt }),
        (patch) => {
          if (!("plan" in patch)) throw new Error("Expected a plan");
          const value = planSchema.parse(patch.plan);
          if (value.kind === "tool" && (!value.tool || !Object.hasOwn(available, value.tool)))
            throw new Error("Plan names an unavailable tool");
          next = value;
        },
      );
      retryHint = undefined;
      attempt = 0;
      emit({
        type: "plan",
        index: steps.length,
        kind: next.kind === "escalate" ? "answer" : next.kind,
        ...(next.tool ? { tool: next.tool } : {}),
        ...(next.why ? { why: next.why } : {}),
        brief: next.brief,
      });
      if (next.kind === "escalate") return escalate("conductor-asked");
      if (next.kind === "answer") {
        const answerInput = {
          model: input.model,
          instructions,
          ask,
          summary: state.summary,
          steps,
          ...signal,
          ...budget,
        };
        let text = await runAnswerStep(answerInput);
        if (judgeAnswer(text))
          text = await runAnswerStep({ ...answerInput, nudge: EMPTY_ANSWER_NUDGE });
        if (judgeAnswer(text)) return escalate("empty-answer");
        return finishAnswer(text, { brief: next.brief, persist: true });
      }
      const tool =
        next.tool && Object.hasOwn(available, next.tool) ? available[next.tool] : undefined;
      if (!tool) return escalate("plan-invalid");
      const started = Date.now();
      const prepared = await prepareToolCall({
        model: input.model,
        instructions,
        tool,
        brief: next.brief,
        ask,
        ...signal,
        ...budget,
      });
      if (!prepared.ok) return escalate(prepared.reason);
      let args = prepared.input;
      let outcomeTool: ToolOutcome | undefined;
      let text = "";
      if (prepared.missing) {
        outcomeTool = { status: "skipped", reason: "missing" };
        text = `missing: ${prepared.missing}. Ask the user or use another tool.`;
      } else {
        try {
          await hooks.run(
            "beforeTool",
            () => ({ tool: toolInfo(tool), input: args, brief: next.brief, steps }),
            async (patch) => {
              if (!("input" in patch)) throw new Error("Expected tool input");
              args = await tool.parameters.parseAsync(copyData(patch.input));
            },
          );
        } catch (error) {
          if (!(error instanceof ExtensionDeny)) throw error;
          outcomeTool = { status: "skipped", reason: "policy", extension: error.extension };
          text = `denied by extension ${error.extension}: ${clip(error.reason, 160)}. Do not retry unless asked.`;
        }
      }
      if (!outcomeTool) {
        const previous = steps.filter((s) => s.kind === "tool" && s.tool === tool.name).at(-1);
        const sameInput = previous && JSON.stringify(previous.input) === JSON.stringify(args);
        const emptyArgs =
          args !== null && typeof args === "object" && Object.keys(args).length === 0;
        if (
          !tool.writes &&
          emptyArgs &&
          previous &&
          sameInput &&
          !previous.cached &&
          !previous.skipped &&
          !previous.failed
        ) {
          outcomeTool = { status: "cached", fromStep: previous.index };
          text = `same as step ${previous.index + 1}`;
        } else {
          // Detect duplicate writes before confirmation or execution, not after the effect.
          const repeat = judgeStep({
            steps,
            maxSteps: input.maxSteps,
            next: { tool: tool.name, input: args },
          });
          if (repeat) return escalate(repeat);
        }
      }
      if (!outcomeTool && tool.writes) {
        checkAbort(input.signal);
        const decision = await operation("confirm", () =>
          input.confirm({ tool: tool.name, input: copyData(args), brief: next.brief }),
        );
        const approved = typeof decision === "boolean" ? decision : decision.approved;
        const reason = typeof decision === "object" ? decision.reason : undefined;
        emit({ type: "confirm", tool: tool.name, approved, ...(reason ? { reason } : {}) });
        if (!approved) {
          outcomeTool = { status: "skipped", reason: "confirmation" };
          text = `declined by the user${reason ? `: ${reason}` : ""}. Do not retry unless asked.`;
        }
      }
      checkAbort(input.signal);
      // Preserve evidence of an attempted effect even if formatting, a hook, or cancellation fails.
      const record: StepRecord = {
        index: steps.length,
        kind: "tool",
        brief: next.brief,
        tool: tool.name,
        input: copyData(args),
        result: "(tool execution did not complete)",
      };
      steps.push(record);
      if (!outcomeTool) {
        let output: unknown;
        try {
          output = await tool.execute(copyData(args), {
            ...signal,
            ...(input.context !== undefined ? { context: input.context } : {}),
          });
        } catch (error) {
          if (isAbort(error)) throw new OperationError("tool", error);
          outcomeTool = { status: "failed", error };
          text = `error: ${clip(error instanceof Error ? error.message : String(error), 160)}. Try different arguments or another tool.`;
        }
        if (!outcomeTool) {
          outcomeTool = { status: "executed", output };
          record.result = "(tool executed; output processing did not complete)";
          checkAbort(input.signal);
          text = await operation("formatter", () =>
            tool.toModelOutput ? tool.toModelOutput(output) : summarizeToolResult(output),
          );
        }
      }
      if (outcomeTool.status === "skipped") {
        record.skipped = true;
        record.skipReason = outcomeTool.reason;
        if (outcomeTool.extension) record.extension = outcomeTool.extension;
      } else if (outcomeTool.status === "cached") record.cached = true;
      else {
        record.skipped = false;
        if (outcomeTool.status === "failed") record.failed = true;
      }
      await hooks.run(
        "afterTool",
        () => ({
          tool: toolInfo(tool),
          input: args,
          result: text,
          outcome: outcomeTool!,
          steps: steps.slice(0, -1),
        }),
        (patch) => {
          text = z.string().parse(patch.result);
        },
      );
      record.result = strictBudget ? summarizeToolResult(text) : text;
      emit({
        type: "tool",
        tool: tool.name,
        input: copyData(args),
        result: record.result,
        ms: outcomeTool.status === "cached" ? 0 : Date.now() - started,
      });
      const failing = judgeToolFailures(steps);
      if (failing) return escalate(failing, record.result);
    }
  }
};
const EMPTY_ANSWER_NUDGE =
  "Your previous reply was empty. Answer now from what you found above; do not mention this notice.";
const describeError = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);
const isGuardrail = (error: unknown): boolean =>
  /guardrail|content.?filter|safety/i.test(describeError(error));
export { runTurn };
export type { TurnInput };
