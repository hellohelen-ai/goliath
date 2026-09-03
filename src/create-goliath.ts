import { inMemory } from "./memory/in-memory.js";
import { runTurn } from "./run-turn.js";
import type { GoliathConfig, RunResult, TraceEvent } from "./types.js";

const DEFAULT_WINDOW = 4096;
const DEFAULT_MAX_STEPS = 5;

type RunOptions = {
  signal?: AbortSignal;
  onEvent?: (event: TraceEvent) => void;
};

type Goliath = {
  run: (ask: string, options?: RunOptions) => Promise<RunResult>;
};

/**
 * Build a Goliath. Give it a model, the tools the app allows, somewhere to
 * remember, and somewhere to send what the phone cannot finish.
 */
const createGoliath = (config: GoliathConfig): Goliath => {
  const memory = config.memory ?? inMemory();
  const confirm = config.confirm ?? (async () => true);

  return {
    run: (ask, options = {}) =>
      runTurn({
        ask,
        model: config.model,
        tools: config.tools ?? {},
        memory,
        confirm,
        ...(config.fallback ? { fallback: config.fallback } : {}),
        ...(config.persona ? { persona: config.persona } : {}),
        maxSteps: config.maxSteps ?? DEFAULT_MAX_STEPS,
        window: config.window ?? DEFAULT_WINDOW,
        onEvent: (event) => {
          config.onEvent?.(event);
          options.onEvent?.(event);
        },
        ...(options.signal ? { signal: options.signal } : {}),
      }),
  };
};

export { createGoliath, DEFAULT_MAX_STEPS, DEFAULT_WINDOW };
export type { Goliath, RunOptions };
