import { inMemory } from "./memory/in-memory.js";
import { runTurn } from "./run-turn.js";
import type { GoliathConfig, RunResult, TraceEvent } from "./types.js";

const DEFAULT_WINDOW = 4096;
const DEFAULT_MAX_STEPS = 5;
const SESSION_FALLBACK_AFTER = 3;

type RunOptions<C = unknown> = {
  signal?: AbortSignal;
  onEvent?: (event: TraceEvent) => void;
} & (unknown extends C ? { context?: C } : { context: C });
type Goliath<C = unknown> = {
  run: (
    ask: string,
    ...options: unknown extends C ? [options?: RunOptions<C>] : [options: RunOptions<C>]
  ) => Promise<RunResult>;
  readonly sessionFallback: boolean;
};

/** Build a reusable harness. Extension state is allocated separately for every run. */
const createGoliath = <C = unknown>(config: GoliathConfig<C>): Goliath<C> => {
  const window = config.window ?? DEFAULT_WINDOW;
  const maxSteps = config.maxSteps ?? DEFAULT_MAX_STEPS;
  if (!Number.isFinite(window) || window <= 0)
    throw new Error("window must be a positive finite number");
  if (!Number.isInteger(maxSteps) || maxSteps < 0)
    throw new Error("maxSteps must be a nonnegative integer");
  const memory = config.memory ?? inMemory();
  const confirm = config.confirm ?? (async () => true);
  const tools = Object.fromEntries(
    Object.values(config.tools ?? {}).map((tool) => [tool.name, tool]),
  );
  const extensions = [...(config.extensions ?? [])];
  const names = new Set<string>();
  for (const extension of extensions) {
    if (typeof extension.name !== "string" || !extension.name.trim() || names.has(extension.name))
      throw new Error("Extension names must be nonempty and unique");
    names.add(extension.name);
  }
  let consecutiveModelErrors = 0;
  const run = async (
    ask: string,
    options: RunOptions<C> = {} as RunOptions<C>,
  ): Promise<RunResult> => {
    const sessionFallback = consecutiveModelErrors >= SESSION_FALLBACK_AFTER && !!config.fallback;
    const result = await runTurn<C>({
      ask,
      model: config.model,
      tools,
      memory,
      confirm,
      extensions,
      sessionFallback,
      maxSteps,
      window,
      onEvent: (event) => {
        config.onEvent?.(event);
        options.onEvent?.(event);
      },
      ...(config.facts ? { facts: config.facts } : {}),
      ...(config.examples ? { examples: config.examples } : {}),
      ...(config.fallback ? { fallback: config.fallback } : {}),
      ...(config.instructions !== undefined ? { instructions: config.instructions } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.context !== undefined ? { context: options.context } : {}),
    });
    // Stops and cloud-only turns say nothing about device health. Exceptions never reach here.
    if (!result.stopped && !sessionFallback) {
      consecutiveModelErrors = result.trace.some(
        (e) => e.type === "escalate" && e.reason === "model-error",
      )
        ? consecutiveModelErrors + 1
        : 0;
    }
    return result;
  };
  return {
    run: run as Goliath<C>["run"],
    get sessionFallback() {
      return consecutiveModelErrors >= SESSION_FALLBACK_AFTER;
    },
  };
};
export { createGoliath, DEFAULT_MAX_STEPS, DEFAULT_WINDOW, SESSION_FALLBACK_AFTER };
export type { Goliath, RunOptions };
