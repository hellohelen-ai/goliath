import type { LanguageModel, ModelMessage } from "ai";
import type { z } from "zod";

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
  /**
   * What the model sees. The app keeps the full output; the model gets this
   * string. Default: `key: value` lines capped at 600 characters.
   */
  toModelOutput?: (output: OUTPUT) => string;
  /**
   * Tools that must have run earlier in the turn. Rendered to the conductor
   * as "Use lookupContact before sendMessage." TinyAgent's biggest plan-shape
   * lever was exactly this sentence.
   */
  requires?: string[];
};

type ToolContext = {
  signal?: AbortSignal;
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
  /** The model or provider error message, when `reason` is "model-error". */
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
  skipped?: boolean;
  /** Served from an earlier identical step; nothing ran. */
  cached?: boolean;
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
  | { type: "budget"; label: string; tokens: number; limit: number };

type RunResult = {
  text: string;
  handledBy: "device" | "cloud";
  /** True when the loop stalled, no fallback was configured, and the answer is a best effort from the step log. */
  bestEffort?: boolean;
  steps: StepRecord[];
  trace: TraceEvent[];
};

type Compressor = (input: {
  messages: ModelMessage[];
  ask: string;
  budget: number;
}) => Promise<ModelMessage[]> | ModelMessage[];

type GoliathConfig = {
  /** Any AI SDK language model. On a phone, `apple()` from `@react-native-ai/apple`. */
  model: LanguageModel;
  tools?: ToolMap;
  memory?: Memory;
  fallback?: Fallback;
  /** Asked before any tool with `writes: true` runs. Default approves everything. */
  confirm?: Confirm;
  /** Context window in tokens. Apple Foundation Models: 4096. */
  window?: number;
  /** Most stones the conductor may throw in one turn. Default 5. */
  maxSteps?: number;
  /** Extra compressors run after the built-in structural pass. */
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
  PlanExample,
  RunResult,
  StepRecord,
  ToolContext,
  ToolMap,
  TraceEvent,
};
