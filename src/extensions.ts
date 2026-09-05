import type { Plan } from "./conductor.js";
import type {
  Exchange,
  FallbackRequest,
  MemoryState,
  RunResult,
  StepRecord,
  TraceEvent,
} from "./types.js";

type MaybePromise<T> = T | Promise<T>;
/** Plain phase data is copied. Opaque values and app context remain application-owned. */
type ReadonlyData<T> = T extends (...args: any[]) => any
  ? T
  : T extends readonly (infer U)[]
    ? readonly ReadonlyData<U>[]
    : T extends object
      ? { readonly [K in keyof T]: ReadonlyData<T[K]> }
      : T;

type StopDecision = { action: "stop"; text: string; reason: string };
type ToolDecision = { action: "deny"; reason: string };
type ToolInfo = { name: string; description: string; writes: boolean };
type ToolOutcome =
  | { status: "executed"; output: unknown }
  | { status: "cached"; fromStep: number }
  | { status: "skipped"; reason: "policy" | "confirmation" | "missing"; extension?: string }
  | { status: "failed"; error: unknown };
type ErrorOrigin =
  | "extension"
  | "model"
  | "memory"
  | "confirm"
  | "fallback"
  | "formatter"
  | "event"
  | "config"
  | "budget"
  | "tool"
  | "harness";
type RunOutcome =
  | { status: "completed" | "stopped"; result: RunResult }
  | {
      status: "error" | "aborted";
      error: unknown;
      origin: ErrorOrigin;
      steps: StepRecord[];
      trace: TraceEvent[];
    };
type ExtensionDiagnostic = { extension: string; phase: "onError" | "onFinish"; error: unknown };

type HookInputs = {
  beforeRun: { ask: string; instructions: string; facts: Record<string, string> };
  afterRecall: { memory: MemoryState };
  beforePlan: {
    ask: string;
    tools: ToolInfo[];
    contextText: string;
    steps: StepRecord[];
    attempt: number;
  };
  afterPlan: { plan: Plan; tools: ToolInfo[]; steps: StepRecord[]; attempt: number };
  beforeTool: { tool: ToolInfo; input: unknown; brief: string; steps: StepRecord[] };
  afterTool: {
    tool: ToolInfo;
    input: unknown;
    result: string;
    outcome: ToolOutcome;
    steps: StepRecord[];
  };
  beforeFallback: { request: Omit<FallbackRequest, "signal"> };
  afterAnswer: {
    text: string;
    handledBy: RunResult["handledBy"];
    bestEffort: boolean;
    steps: StepRecord[];
  };
  beforeRemember: { memory: MemoryState; exchange: Exchange };
  onError: { error: unknown; origin: ErrorOrigin; steps: StepRecord[]; trace: TraceEvent[] };
  onFinish: { outcome: RunOutcome; diagnostics: ExtensionDiagnostic[] };
};
type HookResults = {
  beforeRun: { ask?: string; instructions?: string; facts?: Record<string, string> } | StopDecision;
  afterRecall: { memory: MemoryState };
  beforePlan: { tools?: string[]; contextText?: string };
  afterPlan: { plan: Plan } | StopDecision;
  beforeTool: { input: unknown } | ToolDecision | StopDecision;
  afterTool: { result: string };
  beforeFallback: { request: Omit<FallbackRequest, "signal"> } | StopDecision;
  afterAnswer: { text: string } | StopDecision;
  beforeRemember: { memory: MemoryState } | { action: "skip" };
  onError: never;
  onFinish: never;
};
type HookPhase = keyof HookInputs;
type HookContext<C = unknown> = {
  readonly runId: string;
  readonly context: ReadonlyData<C>;
  readonly signal: AbortSignal | undefined;
  /** Private to this extension and this run. Never persisted or sent to a model. */
  readonly state: Map<string, unknown>;
};
/** Hooks are awaited in array order, including after hooks. Return patches, not mutations. */
type Hook<C, K extends HookPhase> = (
  input: HookContext<C> & ReadonlyData<HookInputs[K]>,
) => MaybePromise<ReadonlyData<HookResults[K]> | void>;
type GoliathExtension<C = unknown> = { readonly name: string } & {
  [K in HookPhase]?: Hook<C, K>;
};

class GoliathExtensionError extends Error {
  override readonly name = "GoliathExtensionError";
  constructor(
    readonly extension: string,
    readonly phase: HookPhase,
    cause: unknown,
  ) {
    super(
      `Extension "${extension}" failed in ${phase}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}

/** Internal control flow, never used to recover from a callback throwing. */
class ExtensionStop {
  constructor(
    readonly extension: string,
    readonly phase: HookPhase,
    readonly decision: StopDecision,
  ) {}
}
class ExtensionDeny {
  constructor(
    readonly extension: string,
    readonly reason: string,
  ) {}
}

const checkAbort = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    // Normalize custom AbortSignal reasons as cancellation, not provider failures.
    const error = new Error("The run was aborted", { cause: signal.reason });
    error.name = "AbortError";
    throw error;
  }
};
const isAbort = (error: unknown): boolean =>
  (error as { name?: string } | null)?.name === "AbortError";

/** Copy data snapshots without requiring structuredClone on React Native. Opaque values stay opaque. */
const copyData = <T>(value: T, seen = new WeakMap<object, unknown>()): T => {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value) as T;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    return value;
  const result: any = Array.isArray(value) ? [] : {};
  seen.set(value, result);
  for (const key of Object.keys(value))
    Object.defineProperty(result, key, {
      value: copyData((value as any)[key], seen),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  return result;
};
let nextRunId = 0;

const createExtensionRunner = <C>(
  extensions: readonly GoliathExtension<C>[],
  context: C,
  signal?: AbortSignal,
) => {
  const runId = `goliath-${Date.now().toString(36)}-${++nextRunId}`;
  const entries = extensions.map((extension) => ({ extension, state: new Map<string, unknown>() }));
  const diagnostics: ExtensionDiagnostic[] = [];
  const inputFor = <K extends HookPhase>(entry: (typeof entries)[number], data: HookInputs[K]) =>
    ({
      ...copyData(data),
      runId,
      context,
      signal,
      state: entry.state,
    }) as HookContext<C> & ReadonlyData<HookInputs[K]>;

  return {
    diagnostics,
    async run<K extends Exclude<HookPhase, "onError" | "onFinish">>(
      phase: K,
      data: () => HookInputs[K],
      apply: (result: ReadonlyData<HookResults[K]>, extension: string) => MaybePromise<void>,
    ): Promise<void> {
      checkAbort(signal);
      for (const entry of entries) {
        const hook = entry.extension[phase] as Hook<C, K> | undefined;
        if (!hook) continue;
        try {
          const result = await hook(inputFor(entry, data()));
          checkAbort(signal);
          if (result === undefined) continue;
          if (result === null || typeof result !== "object")
            throw new Error("Expected a hook result object or void");
          if ("action" in result && result.action === "stop") {
            if (
              !["beforeRun", "afterPlan", "beforeTool", "beforeFallback", "afterAnswer"].includes(
                phase,
              )
            )
              throw new Error("This phase cannot stop the run");
            if (typeof result.text !== "string" || typeof result.reason !== "string")
              throw new Error("A stop requires text and reason");
            throw new ExtensionStop(entry.extension.name, phase, result as StopDecision);
          }
          if (phase === "beforeTool" && "action" in result && result.action === "deny") {
            if (typeof result.reason !== "string") throw new Error("A denial requires a reason");
            throw new ExtensionDeny(entry.extension.name, result.reason);
          }
          await apply(result, entry.extension.name);
          checkAbort(signal);
          if (phase === "beforeRemember" && "action" in result && result.action === "skip") return;
        } catch (error) {
          if (error instanceof ExtensionStop || error instanceof ExtensionDeny || isAbort(error))
            throw error;
          throw new GoliathExtensionError(entry.extension.name, phase, error);
        }
      }
    },
    async notify<K extends "onError" | "onFinish">(phase: K, data: HookInputs[K]): Promise<void> {
      // Cancellation must not suppress cleanup, nor one failed observer suppress the next.
      for (const entry of entries) {
        const hook = entry.extension[phase] as Hook<C, K> | undefined;
        if (!hook) continue;
        try {
          await hook(inputFor(entry, data));
        } catch (error) {
          diagnostics.push({ extension: entry.extension.name, phase, error });
        }
      }
    },
  };
};

export { GoliathExtensionError };
export type {
  GoliathExtension,
  HookContext,
  HookPhase,
  ToolInfo,
  ToolOutcome,
  RunOutcome,
  ErrorOrigin,
  ExtensionDiagnostic,
  StopDecision,
  ToolDecision,
};
export { createExtensionRunner, copyData, checkAbort, isAbort, ExtensionStop, ExtensionDeny };
