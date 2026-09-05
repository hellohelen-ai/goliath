import type { LanguageModel, ModelMessage } from "ai";
import type { z } from "zod";
import type { ExtensionDiagnostic, GoliathExtension, HookPhase } from "./extensions.js";

/** A factory lets stateful providers create a fresh model/session for each generation. */
type ModelSource = LanguageModel | (() => LanguageModel);
/** Count text with the same tokenizer as the model. Provider framing is reserved separately. */
type TokenCounter = (text: string) => number | Promise<number>;

/**
 * A tool the phone's model may call. Keep the schema flat and the
 * description one sentence: a 3B model reads every word of it on every step.
 */
type GoliathTool<INPUT = unknown, OUTPUT = unknown> = {
  name: string;
  description: string;
  parameters: z.ZodType<INPUT>;
  /** True when the tool changes something. Goliath asks before running it. */
  writes?: boolean;
  execute: (input: INPUT, context: ToolContext) => Promise<OUTPUT> | OUTPUT;
  /** Resolve selected references from full earlier outputs before validation and confirmation. */
  resolveInput?: (input: INPUT, context: ToolContext) => INPUT | Promise<INPUT>;
  /**
   * What the model sees. The app keeps the full output; the model gets this
   * string, capped at 600 characters even with a custom formatter.
   * Default: `key: value` lines.
   */
  toModelOutput?: (output: OUTPUT) => string;
  /**
   * Tools that must have run earlier in the turn. Rendered to the conductor
   * as "Use lookupContact before sendMessage." TinyAgent's biggest plan-shape
   * lever was exactly this sentence.
   */
  requires?: string[];
};

type ToolContext<C = unknown> = {
  /** Application context supplied to run; never injected into prompts automatically. */
  context?: C;
  signal?: AbortSignal;
  /** Earlier steps in this turn. Full JSON-serializable outputs stay outside model prompts. */
  steps?: readonly StepRecord[];
  /** Latest exchanges, including their tool records when available. */
  recent?: readonly Exchange[];
};

type ToolMap = Record<string, GoliathTool<any, any>>;

/** What Goliath remembers between turns. Small on purpose. */
type MemoryState = {
  /** A rolling brief of everything that came before, written by the scribe. */
  summary: string;
  /** The last few exchanges, verbatim, newest last. */
  recent: Exchange[];
};

type Exchange = {
  ask: string;
  answer: string;
  at: number;
  /** Exact arguments, outcomes, and JSON-serializable outputs from this exchange. */
  steps?: StepRecord[];
};

type Memory = {
  load: () => Promise<MemoryState>;
  save: (state: MemoryState) => Promise<void>;
};

/** Where a turn goes when the phone cannot finish it. */
type Fallback = (request: FallbackRequest) => Promise<{ text: string }>;

type FallbackRequest = {
  ask: string;
  summary: string;
  recent: Exchange[];
  steps: StepRecord[];
  reason: EscalationReason;
  /** Details for model failures or requests rejected by the context budget guard. */
  error?: string;
  signal?: AbortSignal;
};

type EscalationReason =
  | "no-model"
  | "model-unavailable"
  | "too-many-steps"
  | "repeated-tool-call"
  | "empty-answer"
  | "plan-invalid"
  | "conductor-asked"
  | "tool-args-invalid"
  | "tool-error"
  | "guardrail"
  | "context-budget"
  | "tool-prerequisite-missing"
  | "model-error";

/** One stone thrown: what the conductor decided and what the worker did. */
type StepRecord = {
  index: number;
  kind: "tool" | "answer";
  brief: string;
  tool?: string;
  input?: unknown;
  /** The compressed tool result the transcript carries forward. */
  result?: string;
  /** Full JSON-serializable output for application code. Never rendered into a prompt. */
  output?: unknown;
  /** A state-changing tool was selected; used to invalidate earlier read results. */
  writes?: boolean;
  skipped?: boolean;
  /** Served from an earlier identical step; nothing ran. */
  cached?: boolean;
  /** Why execution was skipped, when applicable. */
  skipReason?: "policy" | "confirmation" | "missing";
  extension?: string;
  /** The tool threw. `result` carries the message the conductor plans around. */
  failed?: boolean;
  text?: string;
};

type ConfirmDecision = boolean | { approved: boolean; reason?: string };

/** Asked before a tool that writes runs. A reason on a decline reaches the conductor. */
type Confirm = (request: {
  tool: string;
  input: unknown;
  brief: string;
}) => Promise<ConfirmDecision>;

type TraceEvent =
  | { type: "recall"; summary: string; recent: number }
  | {
      type: "plan";
      index: number;
      kind: StepRecord["kind"];
      tool?: string;
      /** The conductor's one-sentence rationale, when it gave one. */
      why?: string;
      brief: string;
    }
  | { type: "confirm"; tool: string; approved: boolean; reason?: string }
  | { type: "tool"; tool: string; input: unknown; result: string; ms: number }
  | { type: "answer"; text: string }
  | { type: "escalate"; reason: EscalationReason; error?: string }
  | { type: "remember"; summary: string }
  | { type: "memory-error"; error: string }
  | {
      type: "budget";
      label: string;
      tokens: number;
      limit: number;
      source?: "tokenizer" | "estimate";
    };

type RunResult = {
  text: string;
  handledBy: "device" | "cloud";
  /** True when the loop stalled, no fallback was configured, and the answer is a best effort from the step log. */
  bestEffort?: boolean;
  steps: StepRecord[];
  trace: TraceEvent[];
  stopped?: { extension: string; phase: HookPhase; reason: string };
  /** Observer/cleanup failures do not replace the original outcome. */
  diagnostics?: ExtensionDiagnostic[];
};

type Compressor = (input: {
  messages: ModelMessage[];
  ask: string;
  budget: number;
}) => Promise<ModelMessage[]> | ModelMessage[];

type GoliathConfig<C = unknown> = {
  /** Awaited in array order. Hooks change behavior; onEvent observes it. */
  extensions?: readonly GoliathExtension<C>[];
  /** Any AI SDK language model. On a phone, `apple()` from `@react-native-ai/apple`. */
  model: ModelSource;
  tools?: ToolMap;
  memory?: Memory;
  fallback?: Fallback;
  /** Asked before any tool with `writes: true` runs. Default approves everything. */
  confirm?: Confirm;
  /** Total input + output window in tokens. Every model call is budgeted. Default 4096. */
  window?: number | (() => number | Promise<number>);
  /** Optional native/provider tokenizer. A failing counter stops generation rather than guessing. */
  countTokens?: TokenCounter;
  /** Most stones the conductor may throw in one turn. Default 5. */
  maxSteps?: number;
  /** @deprecated This option is unused. Use afterTool and beforePlan extensions instead. */
  compressors?: Compressor[];
  /** Who Goliath is, in one or two short sentences. Every prompt starts with it. */
  instructions?: string;
  /** Called for every trace event as it happens. */
  onEvent?: (event: TraceEvent) => void;
  /**
   * Values the model should always have, injected as `key: value` lines
   * instead of fetched by a tool (Apple TN3193: run the tool before the model
   * when it always needs the result). Today's date, timezone, the user's name.
   * A function is called once per turn.
   */
  facts?: Record<string, string> | (() => Record<string, string>);
  /**
   * Two or three worked plans, shown to the conductor. Format is fixed by
   * guided generation; examples buy tool choice and ordering. Measure before
   * keeping any: each costs ~60 tokens per step.
   */
  examples?: PlanExample[];
};

type PlanExample = {
  ask: string;
  /** The steps a good run takes, in order, with `answer` last. */
  steps: Array<{ tool: string; brief: string } | { answer: string }>;
};

export type {
  Compressor,
  Confirm,
  ConfirmDecision,
  EscalationReason,
  Exchange,
  Fallback,
  FallbackRequest,
  GoliathConfig,
  GoliathTool,
  Memory,
  MemoryState,
  ModelSource,
  PlanExample,
  RunResult,
  StepRecord,
  ToolContext,
  ToolMap,
  TokenCounter,
  TraceEvent,
};
