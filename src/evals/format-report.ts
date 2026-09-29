import type { EvalReport } from "./types.js";

export function formatReport(report: EvalReport): string {
  const lines = report.outcomes.map(
    (outcome) =>
      `${outcome.pass ? "PASS" : "FAIL"}  ${outcome.id.padEnd(18)} ${outcome.passes}/${outcome.runs}  ${outcome.reasons.join("; ")}`,
  );
  lines.push(
    "",
    `${report.passed}/${report.total} passed (pass^${report.runs}) · ${report.totalRuns} attempts · ${report.onDevice} on device · ${report.escalated} escalated · ${report.errors} errors · ${report.meanSteps} steps/attempt`,
  );
  return lines.join("\n");
}
