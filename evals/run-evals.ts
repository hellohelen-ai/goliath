import type { LanguageModel } from "ai";
import { z } from "zod";
import { createGoliath, defineTool, type Fallback, type GoliathTool } from "../src/index.js";
import type { Fixture } from "./fixtures.js";

type EvalOutcome = {
  id: string;
  pass: boolean;
  handledBy: "device" | "cloud";
  tools: string[];
  text: string;
  reasons: string[];
  ms: number;
  /** Stones thrown. An efficiency signal, logged but never a failure. */
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
const runEvals = async (input: {
  model: LanguageModel | ((fixture: Fixture) => LanguageModel);
  fixtures: Fixture[];
  fallback?: Fallback;
}): Promise<EvalReport> => {
  const outcomes: EvalOutcome[] = [];

  for (const fixture of input.fixtures) {
    const model = typeof input.model === "function" ? input.model(fixture) : input.model;
    const goliath = createGoliath({
      model,
      tools: sampleTools(),
      fallback: input.fallback ?? (async () => ({ text: "(cloud)" })),
    });
    const started = Date.now();
    const result = await goliath.run(fixture.ask);
    const tools = result.steps.filter((s) => s.kind === "tool").map((s) => s.tool ?? "");
    const reasons: string[] = [];
    if (result.handledBy !== fixture.handledBy) {
      reasons.push(`handledBy ${result.handledBy}, wanted ${fixture.handledBy}`);
    }
    if (tools.join(",") !== fixture.tools.join(",")) {
      reasons.push(`tools [${tools}], wanted [${fixture.tools}]`);
    }
    for (const word of fixture.mentions ?? []) {
      if (!result.text.toLowerCase().includes(word)) reasons.push(`answer lacks "${word}"`);
    }
    outcomes.push({
      id: fixture.id,
      pass: reasons.length === 0,
      handledBy: result.handledBy,
      tools,
      text: result.text,
      reasons,
      ms: Date.now() - started,
      steps: result.steps.length,
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
  };
};

const formatReport = (report: EvalReport): string => {
  const lines = report.outcomes.map(
    (o) =>
      `${o.pass ? "PASS" : "FAIL"}  ${o.id.padEnd(18)} ${o.handledBy.padEnd(6)} ${String(o.steps).padStart(2)} steps ${String(o.ms).padStart(5)}ms  ${o.reasons.join("; ")}`,
  );
  lines.push("");
  lines.push(
    `${report.passed}/${report.total} passed · ${report.onDevice} on device · ${report.escalated} escalated · ${report.meanSteps} steps/task`,
  );
  return lines.join("\n");
};

export { formatReport, runEvals, sampleTools };
export type { EvalOutcome, EvalReport };
