import { inMemory } from "./memory/in-memory.js";
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
  const memory = config.memory ?? inMemory();
  const confirm = config.confirm ?? (async () => true);
  // The conductor picks by name, so the map is keyed by each tool's own name,
  // whatever the app called the property.
  const tools = Object.fromEntries(
    Object.values(config.tools ?? {}).map((tool) => [tool.name, tool]),
  );

  let consecutiveModelErrors = 0;

  const goliath: Goliath = {
    get sessionFallback() {
      return consecutiveModelErrors >= SESSION_FALLBACK_AFTER;
    },
    run: async (ask, options = {}) => {
      const emit = (event: TraceEvent) => {
        config.onEvent?.(event);
        options.onEvent?.(event);
      };
      if (goliath.sessionFallback && config.fallback) {
        // Claude Code switches models after three consecutive overloads. A
        // device that has failed three turns running is not coming back this
        // session; stop paying the on-device latency to find out.
        const state = await memory.load();
        emit({ type: "escalate", reason: "model-error", error: "session fallback" });
        const { text } = await config.fallback({
          ask,
          summary: state.summary,
          recent: state.recent,
          steps: [],
          reason: "model-error",
          error: "session fallback",
          ...(options.signal ? { signal: options.signal } : {}),
        });
        return { text, handledBy: "cloud", steps: [], trace: [] };
      }
      const result = await runTurn({
        ask,
        model: config.model,
        tools,
        memory,
        confirm,
        ...(config.fallback ? { fallback: config.fallback } : {}),
        ...(config.instructions ? { instructions: config.instructions } : {}),
        maxSteps: config.maxSteps ?? DEFAULT_MAX_STEPS,
        window: config.window ?? DEFAULT_WINDOW,
        onEvent: emit,
        ...(options.signal ? { signal: options.signal } : {}),
      });
      const diedOnDevice = result.trace.some(
        (e) => e.type === "escalate" && e.reason === "model-error",
      );
      consecutiveModelErrors = diedOnDevice ? consecutiveModelErrors + 1 : 0;
      return result;
    },
  };
  return goliath;
};

export { createGoliath, DEFAULT_MAX_STEPS, DEFAULT_WINDOW, SESSION_FALLBACK_AFTER };
export type { Goliath, RunOptions };
