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
type Agent<C = unknown> = {
  run: (
    ask: string,
    ...options: unknown extends C ? [options?: RunOptions<C>] : [options: RunOptions<C>]
  ) => Promise<RunResult>;
  readonly sessionFallback: boolean;
};

/** Build a reusable harness. Extension state is allocated separately for every run. */
const createAgent = <C = unknown>(config: GoliathConfig<C>): Agent<C> => {
  if (typeof config.window === "number") validateWindow(config.window);
  let lastWindow = typeof config.window === "number" ? config.window : DEFAULT_WINDOW;
  let pending: Promise<unknown> = Promise.resolve();
  const maxSteps = config.maxSteps ?? DEFAULT_MAX_STEPS;
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
    const window =
      sessionFallback || options.signal?.aborted
        ? lastWindow
        : typeof config.window === "function"
          ? await config.window()
          : (config.window ?? DEFAULT_WINDOW);
    validateWindow(window);
    lastWindow = window;
    const result = await runTurn<C>({
      ask,
      model: config.model,
      ...(config.countTokens ? { countTokens: config.countTokens } : {}),
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
    run: ((ask: string, options?: RunOptions<C>) => {
      const result = pending.then(() => run(ask, options));
      pending = result.catch(() => undefined);
      return result;
    }) as Agent<C>["run"],
    get sessionFallback() {
      return consecutiveModelErrors >= SESSION_FALLBACK_AFTER;
    },
  };
};
const validateWindow = (window: number): void => {
  if (!Number.isSafeInteger(window) || window <= 0)
    throw new Error("window must be a positive integer token count");
};
export { createAgent, DEFAULT_MAX_STEPS, DEFAULT_WINDOW, SESSION_FALLBACK_AFTER };
export type { Agent, RunOptions };
