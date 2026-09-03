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
  signal?: AbortSignal;
};

type EscalationReason =
  | "no-model"
  | "model-unavailable"
  | "too-many-steps"
  | "repeated-tool-call"
  | "empty-answer"
  | "plan-invalid"
  | "conductor-asked";

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
  text?: string;
};

type Confirm = (request: { tool: string; input: unknown; brief: string }) => Promise<boolean>;

type TraceEvent =
  | { type: "recall"; summary: string; recent: number }
  | { type: "plan"; index: number; kind: StepRecord["kind"]; tool?: string; brief: string }
  | { type: "confirm"; tool: string; approved: boolean }
  | { type: "tool"; tool: string; input: unknown; result: string; ms: number }
  | { type: "answer"; text: string }
  | { type: "escalate"; reason: EscalationReason }
  | { type: "remember"; summary: string }
  | { type: "budget"; label: string; tokens: number; limit: number };

type RunResult = {
  text: string;
  handledBy: "device" | "cloud";
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
  /** Who Goliath is, in one or two short sentences. */
  persona?: string;
  /** Called for every trace event as it happens. */
  onEvent?: (event: TraceEvent) => void;
};

export type {
  Compressor,
  Confirm,
  EscalationReason,
  Exchange,
  Fallback,
  FallbackRequest,
  GoliathConfig,
  GoliathTool,
  Memory,
  MemoryState,
  RunResult,
  StepRecord,
  ToolContext,
  ToolMap,
  TraceEvent,
};
