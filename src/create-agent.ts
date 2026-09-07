import type { z } from "zod";
import { inMemory } from "./memory/in-memory.js";
import { runTurn } from "./run-turn.js";
import type { Confirm, GoliathConfig, Memory, RunResult, TraceEvent } from "./types.js";

const DEFAULT_WINDOW = 4096;
const DEFAULT_MAX_STEPS = 5;
const SESSION_FALLBACK_AFTER = 3;

type RunOptions<C = unknown, T = unknown> = {
  /** Omit to use the default conversation. Named conversations have isolated session state. */
  conversationId?: string;
  /** Approval handler for this run; overrides the config-level handler. */
  confirm?: Confirm;
  /** Override the configured structured answer schema for this turn. */
  outputSchema?: z.ZodType<T>;
  signal?: AbortSignal;
  onEvent?: (event: TraceEvent) => void;
} & (unknown extends C ? { context?: C } : { context: C });
type Agent<C = unknown, T = unknown> = {
  run: {
    <OUTPUT>(
      ask: string,
      options: RunOptions<C, OUTPUT> & { outputSchema: z.ZodType<OUTPUT> },
    ): Promise<RunResult<OUTPUT>>;
    (
      ask: string,
      ...options: unknown extends C ? [options?: RunOptions<C, T>] : [options: RunOptions<C, T>]
    ): Promise<RunResult<T>>;
  };
  /** Fallback state of the default conversation. */
  readonly sessionFallback: boolean;
  isSessionFallback: (conversationId?: string) => boolean;
};

type Session = {
  memory: Memory;
  pending: Promise<unknown>;
  lastWindow: number;
  consecutiveModelErrors: number;
};

/** Build a reusable harness. Extension state is allocated separately for every run. */
const createAgent = <C = unknown, T = unknown>(config: GoliathConfig<C, T>): Agent<C, T> => {
  if (typeof config.window === "number") validateWindow(config.window);
  const sessions = new Map<string | undefined, Session>();
  const maxSteps = config.maxSteps ?? DEFAULT_MAX_STEPS;
  if (!Number.isInteger(maxSteps) || maxSteps < 0)
    throw new Error("maxSteps must be a nonnegative integer");
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
  const sessionFor = (conversationId: string | undefined): Session => {
    if (
      conversationId !== undefined &&
      (typeof conversationId !== "string" || !conversationId.trim())
    )
      throw new Error("conversationId must be a nonempty string");
    const existing = sessions.get(conversationId);
    if (existing) return existing;
    if (conversationId !== undefined && config.memory && typeof config.memory !== "function")
      throw new Error(
        "Named conversations require a memory factory instead of a shared Memory object",
      );
    const session: Session = {
      memory:
        typeof config.memory === "function"
          ? config.memory(conversationId)
          : (config.memory ?? inMemory()),
      pending: Promise.resolve(),
      lastWindow: typeof config.window === "number" ? config.window : DEFAULT_WINDOW,
      consecutiveModelErrors: 0,
    };
    sessions.set(conversationId, session);
    return session;
  };
  const isSessionFallback = (conversationId?: string) =>
    (sessions.get(conversationId)?.consecutiveModelErrors ?? 0) >= SESSION_FALLBACK_AFTER;
  const run = async (
    session: Session,
    ask: string,
    options: RunOptions<C> = {} as RunOptions<C>,
  ): Promise<RunResult> => {
    const sessionFallback =
      session.consecutiveModelErrors >= SESSION_FALLBACK_AFTER && !!config.fallback;
    const window =
      sessionFallback || options.signal?.aborted
        ? session.lastWindow
        : typeof config.window === "function"
          ? await config.window()
          : (config.window ?? DEFAULT_WINDOW);
    validateWindow(window);
    session.lastWindow = window;
    const outputSchema = options.outputSchema ?? config.outputSchema;
    const result = await runTurn<C>({
      ask,
      model: config.model,
      ...(config.countTokens ? { countTokens: config.countTokens } : {}),
      tools,
      ...(outputSchema ? { outputSchema } : {}),
      memory: session.memory,
      confirm: options.confirm ?? confirm,
      ...(options.conversationId !== undefined ? { conversationId: options.conversationId } : {}),
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
      session.consecutiveModelErrors = result.trace.some(
        (e) => e.type === "escalate" && e.reason === "model-error",
      )
        ? session.consecutiveModelErrors + 1
        : 0;
    }
    return result;
  };
  return {
    run: (async (ask: string, options?: RunOptions<C>) => {
      const runOptions = { ...options } as RunOptions<C>;
      const session = sessionFor(runOptions.conversationId);
      const result = session.pending.then(() => run(session, ask, runOptions));
      session.pending = result.catch(() => undefined);
      return result;
    }) as Agent<C, T>["run"],
    get sessionFallback() {
      return isSessionFallback();
    },
    isSessionFallback,
  };
};
const validateWindow = (window: number): void => {
  if (!Number.isSafeInteger(window) || window <= 0)
    throw new Error("window must be a positive integer token count");
};
export { createAgent, DEFAULT_MAX_STEPS, DEFAULT_WINDOW, SESSION_FALLBACK_AFTER };
export type { Agent, RunOptions };
