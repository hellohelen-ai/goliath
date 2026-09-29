import { createAgent } from "../create-agent.js";
import { checkAbort } from "../context.js";
import { isAbort } from "../extensions.js";
import { sampleTools, type Fixture } from "./fixtures.js";
import { judge } from "./judge.js";
import type { EvalAttempt, EvalOptions, EvalOutcome, EvalReport } from "./types.js";

/** Fresh memory and disposable tools for each attempt; never runs the application's real tools. */
async function runAttempt(input: EvalOptions, fixture: Fixture): Promise<EvalAttempt> {
  const started = Date.now();
  try {
    checkAbort(input.signal);
    const model = typeof input.model === "function" ? input.model(fixture) : input.model;
    const agent = createAgent({
      model,
      tools: sampleTools(),
      fallback: input.fallback ?? (async () => ({ text: "(cloud)" })),
      ...(input.window !== undefined ? { window: input.window } : {}),
      ...(input.countTokens ? { countTokens: input.countTokens } : {}),
      ...(input.budgets ? { budgets: input.budgets } : {}),
      ...(input.maxSteps !== undefined ? { maxSteps: input.maxSteps } : {}),
      ...(input.instructions !== undefined ? { instructions: input.instructions } : {}),
    });
    const result = await agent.run(fixture.ask, input.signal ? { signal: input.signal } : {});
    const tools = result.steps
      .filter((step) => step.kind === "tool")
      .map((step) => step.tool ?? "");
    const reasons = judge(fixture, result, tools);
    return {
      pass: reasons.length === 0,
      handledBy: result.handledBy,
      tools,
      text: result.text,
      reasons,
      ms: Date.now() - started,
      steps: result.steps.length,
    };
  } catch (error) {
    checkAbort(input.signal);
    if (isAbort(error)) throw error;
    return {
      pass: false,
      handledBy: "error",
      tools: [],
      text: "",
      reasons: [`Execution failed: ${error instanceof Error ? error.message : String(error)}`],
      ms: Date.now() - started,
      steps: 0,
    };
  }
}

/** A fixture passes only if every attempt passes. Each failed attempt remains inspectable. */
export async function runEvals(input: EvalOptions): Promise<EvalReport> {
  const runs = input.runs ?? 1;
  if (!Number.isSafeInteger(runs) || runs < 1) throw new Error("runs must be a positive integer");
  const metadata = { ...input.metadata };
  const outcomes: EvalOutcome[] = [];
  for (const fixture of input.fixtures) {
    const attempts: EvalAttempt[] = [];
    for (let i = 0; i < runs; i++) attempts.push(await runAttempt(input, fixture));
    const last = attempts.at(-1)!;
    const passes = attempts.filter((attempt) => attempt.pass).length;
    outcomes.push({
      ...last,
      id: fixture.id,
      pass: passes === runs,
      passes,
      runs,
      attempts,
      reasons: attempts.flatMap((attempt, i) =>
        attempt.reasons.map((reason) => (runs === 1 ? reason : `Run ${i + 1}: ${reason}`)),
      ),
    });
  }
  const attempts = outcomes.flatMap((outcome) => outcome.attempts);
  const passed = outcomes.filter((outcome) => outcome.pass).length;
  return {
    outcomes,
    passed,
    total: outcomes.length,
    passedAllRuns: passed,
    runs,
    metadata,
    totalRuns: attempts.length,
    onDevice: attempts.filter((attempt) => attempt.handledBy === "device").length,
    escalated: attempts.filter((attempt) => attempt.handledBy === "cloud").length,
    errors: attempts.filter((attempt) => attempt.handledBy === "error").length,
    meanSteps: attempts.length
      ? Math.round(
          (attempts.reduce((sum, attempt) => sum + attempt.steps, 0) / attempts.length) * 100,
        ) / 100
      : 0,
  };
}
