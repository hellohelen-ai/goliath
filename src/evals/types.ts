import type { GoliathConfig, ModelSource } from "../types.js";
import type { Fixture } from "./fixtures.js";

export type EvalAttempt = {
  pass: boolean;
  handledBy: "device" | "cloud" | "error";
  tools: string[];
  text: string;
  reasons: string[];
  ms: number;
  steps: number;
};

export type EvalOutcome = EvalAttempt & {
  id: string;
  passes: number;
  runs: number;
  /** Every attempt, including failures before the final run. */
  attempts: EvalAttempt[];
};

export type EvalReport = {
  outcomes: EvalOutcome[];
  passed: number;
  total: number;
  /** Counts across all attempts, not just each fixture's final run. */
  onDevice: number;
  escalated: number;
  errors: number;
  totalRuns: number;
  meanSteps: number;
  passedAllRuns: number;
  runs: number;
  metadata: Record<string, string | number | boolean>;
};

export type EvalOptions = Pick<
  GoliathConfig,
  "fallback" | "window" | "countTokens" | "budgets" | "maxSteps" | "instructions"
> & {
  /** Called per attempt. Return a factory when each generation needs a fresh native session. */
  model: ModelSource | ((fixture: Fixture) => ModelSource);
  fixtures: Fixture[];
  /** Positive integer; use at least 3 for real model evaluation. */
  runs?: number;
  signal?: AbortSignal;
  /** Caller-supplied OS, hardware, provider version, and dataset revision for comparisons. */
  metadata?: Record<string, string | number | boolean>;
};
