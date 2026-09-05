import type { LanguageModel } from "ai";
import { z } from "zod";
import {
  createAgent,
  defineTool,
  type Fallback,
  type GoliathTool,
  type RunResult,
} from "../src/index.js";
import type { Fixture } from "./fixtures.js";

type EvalOutcome = {
  id: string;
  pass: boolean;
  /** Passes out of `runs`; pass^k in τ-bench terms is `passes === runs`. */
  passes: number;
  runs: number;
  handledBy: "device" | "cloud";
  tools: string[];
  text: string;
  reasons: string[];
  ms: number;
  /** Steps taken. An efficiency signal, logged but never a failure. */
  steps: number;
};

type EvalReport = {
  outcomes: EvalOutcome[];
  passed: number;
  total: number;
  onDevice: number;
  escalated: number;
  /** Mean steps per task, to two decimals. */
  meanSteps: number;
  /** Fixtures that passed every run. */
  passedAllRuns: number;
  runs: number;
};

/** A tiny task list every fixture runs against. Fresh per run. */
const sampleTools = (): Record<string, GoliathTool<any, any>> => {
  const tasks = [{ title: "Buy milk" }, { title: "Call mom" }];
  return {
    listTasks: defineTool({
      name: "listTasks",
      description: "The user's open tasks.",
      parameters: z.object({}),
      execute: () => tasks,
    }),
    createTask: defineTool({
      name: "createTask",
      description: "Add a task.",
      parameters: z.object({ title: z.string() }),
      writes: true,
      execute: ({ title }) => {
        tasks.push({ title });
        return { ok: true, title };
      },
    }),
  };
};

/**
 * Run every fixture through Goliath and score it. Pass any AI SDK model: the
 * phone's, a cloud model for a ceiling, or a scripted fake for CI.
 */
const judge = (fixture: Fixture, result: RunResult, tools: string[]): string[] => {
  const reasons: string[] = [];
  const escalation =
    fixture.escalation ?? (fixture.handledBy === "cloud" ? "expected" : "forbidden");
  if (escalation === "forbidden" && result.handledBy === "cloud") {
    reasons.push("escalated, but escalation is forbidden");
  }
  if (escalation === "expected" && result.handledBy !== "cloud") {
    reasons.push("stayed on device, but escalation was expected");
  }
  if (tools.join(",") !== fixture.tools.join(",")) {
    reasons.push(`tools [${tools}], wanted [${fixture.tools}]`);
  }
  const answer = result.text.toLowerCase();
  for (const word of fixture.mentions ?? []) {
    if (!answer.includes(word)) reasons.push(`answer lacks "${word}"`);
  }
  for (const word of fixture.forbids ?? []) {
    if (answer.includes(word)) reasons.push(`answer contains "${word}"`);
  }
  return reasons;
};

/**
 * Run every fixture through Goliath `runs` times and score it. A fixture
 * passes when every run passes (τ-bench's pass^k), because a personal
 * assistant that is right two times in three is not right.
 */
const runEvals = async (input: {
  model: LanguageModel | ((fixture: Fixture) => LanguageModel);
  fixtures: Fixture[];
  fallback?: Fallback;
  /** Times to run each fixture. Default 1; use 3 on a device. */
  runs?: number;
}): Promise<EvalReport> => {
  const runs = Math.max(1, input.runs ?? 1);
  const outcomes: EvalOutcome[] = [];

  for (const fixture of input.fixtures) {
    let passes = 0;
    let last: { result: RunResult; tools: string[]; reasons: string[]; ms: number } | undefined;
    for (let i = 0; i < runs; i += 1) {
      const model = typeof input.model === "function" ? input.model(fixture) : input.model;
      const agent = createAgent({
        model,
        tools: sampleTools(),
        fallback: input.fallback ?? (async () => ({ text: "(cloud)" })),
      });
      const started = Date.now();
      const result = await agent.run(fixture.ask);
      const tools = result.steps.filter((s) => s.kind === "tool").map((s) => s.tool ?? "");
      const reasons = judge(fixture, result, tools);
      if (reasons.length === 0) passes += 1;
      last = { result, tools, reasons, ms: Date.now() - started };
    }
    if (!last) continue;
    outcomes.push({
      id: fixture.id,
      pass: passes === runs,
      passes,
      runs,
      handledBy: last.result.handledBy,
      tools: last.tools,
      text: last.result.text,
      reasons: last.reasons,
      ms: last.ms,
      steps: last.result.steps.length,
    });
  }

  return {
    outcomes,
    passed: outcomes.filter((o) => o.pass).length,
    total: outcomes.length,
    onDevice: outcomes.filter((o) => o.handledBy === "device").length,
    escalated: outcomes.filter((o) => o.handledBy === "cloud").length,
    meanSteps: outcomes.length
      ? Math.round((outcomes.reduce((sum, o) => sum + o.steps, 0) / outcomes.length) * 100) / 100
      : 0,
    passedAllRuns: outcomes.filter((o) => o.passes === o.runs).length,
    runs,
  };
};

const formatReport = (report: EvalReport): string => {
  const lines = report.outcomes.map(
    (o) =>
      `${o.pass ? "PASS" : "FAIL"}  ${o.id.padEnd(18)} ${o.handledBy.padEnd(6)} ${o.passes}/${o.runs} ${String(o.steps).padStart(2)} steps ${String(o.ms).padStart(5)}ms  ${o.reasons.join("; ")}`,
  );
  lines.push("");
  lines.push(
    `${report.passed}/${report.total} passed (pass^${report.runs}) · ${report.onDevice} on device · ${report.escalated} escalated · ${report.meanSteps} steps/task`,
  );
  return lines.join("\n");
};

export { formatReport, runEvals, sampleTools };
export type { EvalOutcome, EvalReport };
