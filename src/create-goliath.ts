import { inMemory } from "./memory/in-memory.js";
import { checkAbort } from "./context.js";
import { remember } from "./scribe.js";
import { runTurn } from "./run-turn.js";
import type { GoliathConfig, RunResult, TraceEvent } from "./types.js";

const DEFAULT_WINDOW = 4096;
const DEFAULT_MAX_STEPS = 5;
/** Consecutive model errors before the rest of the session skips the device. */
const SESSION_FALLBACK_AFTER = 3;

type RunOptions = {
  signal?: AbortSignal;
  onEvent?: (event: TraceEvent) => void;
};

type Goliath = {
  run: (ask: string, options?: RunOptions) => Promise<RunResult>;
  /** True once three turns in a row died on the device; later turns go straight to the cloud. */
  readonly sessionFallback: boolean;
};

/**
 * Build a Goliath. Give it a model, the tools the app allows, somewhere to
 * remember, and somewhere to send what the phone cannot finish.
 */
const createGoliath = (config: GoliathConfig): Goliath => {
  if (typeof config.window === "number") validateWindow(config.window);
  const memory = config.memory ?? inMemory();
  const confirm = config.confirm ?? (async () => true);
  // The conductor picks by name, so the map is keyed by each tool's own name,
  // whatever the app called the property.
  const tools = Object.fromEntries(
    Object.values(config.tools ?? {}).map((tool) => [tool.name, tool]),
  );

  let consecutiveModelErrors = 0;
  let pending: Promise<unknown> = Promise.resolve();
  let lastWindow = typeof config.window === "number" ? config.window : DEFAULT_WINDOW;

  const goliath: Goliath = {
    get sessionFallback() {
      return consecutiveModelErrors >= SESSION_FALLBACK_AFTER;
    },
    run: (ask, options = {}) => {
      const result = pending.then(() => run(ask, options));
      pending = result.catch(() => undefined);
      return result;
    },
  };
  const run = async (ask: string, options: RunOptions): Promise<RunResult> => {
    checkAbort(options.signal);
    const emit = (event: TraceEvent) => {
      config.onEvent?.(event);
      options.onEvent?.(event);
    };
    if (goliath.sessionFallback && config.fallback) {
      // Claude Code switches models after three consecutive overloads. A
      // device that has failed three turns running is not coming back this
      // session; stop paying the on-device latency to find out.
      const state = await memory.load();
      const trace: TraceEvent[] = [
        { type: "escalate", reason: "model-error", error: "session fallback" },
      ];
      emit(trace[0]!);
      const { text } = await config.fallback({
        ask,
        summary: state.summary,
        recent: state.recent,
        steps: [],
        reason: "model-error",
        error: "session fallback",
        ...(options.signal ? { signal: options.signal } : {}),
      });
      const memoryEvent = (event: TraceEvent) => {
        trace.push(event);
        emit(event);
      };
      const next = await remember({
        model: config.model,
        state,
        exchange: { ask, answer: text, at: Date.now() },
        summaryBudget: Math.floor(lastWindow / 8),
        skipModel: true,
      });
      try {
        await memory.save(next);
        memoryEvent({ type: "remember", summary: next.summary });
      } catch (error) {
        memoryEvent({
          type: "memory-error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return { text, handledBy: "cloud", steps: [], trace };
    }
    const window =
      typeof config.window === "function"
        ? await config.window()
        : (config.window ?? DEFAULT_WINDOW);
    validateWindow(window);
    lastWindow = window;
    checkAbort(options.signal);
    const facts = typeof config.facts === "function" ? config.facts() : config.facts;
    const result = await runTurn({
      ask,
      model: config.model,
      tools,
      memory,
      confirm,
      ...(facts ? { facts } : {}),
      ...(config.examples ? { examples: config.examples } : {}),
      ...(config.fallback ? { fallback: config.fallback } : {}),
      ...(config.instructions ? { instructions: config.instructions } : {}),
      maxSteps: config.maxSteps ?? DEFAULT_MAX_STEPS,
      window,
      ...(config.countTokens ? { countTokens: config.countTokens } : {}),
      onEvent: emit,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const diedOnDevice = result.trace.some(
      (e) => e.type === "escalate" && e.reason === "model-error",
    );
    consecutiveModelErrors = diedOnDevice ? consecutiveModelErrors + 1 : 0;
    return result;
  };
  return goliath;
};

const validateWindow = (window: number): void => {
  if (!Number.isSafeInteger(window) || window <= 0)
    throw new Error("window must be a positive integer token count");
};

export { createGoliath, DEFAULT_MAX_STEPS, DEFAULT_WINDOW, SESSION_FALLBACK_AFTER };
export type { Goliath, RunOptions };
