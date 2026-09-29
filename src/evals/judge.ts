import type { RunResult } from "../types.js";
import type { Fixture } from "./fixtures.js";

export function judge(fixture: Fixture, result: RunResult, tools: string[]): string[] {
  const reasons: string[] = [];
  const escalation =
    fixture.escalation ?? (fixture.handledBy === "cloud" ? "expected" : "forbidden");
  if (escalation === "forbidden" && result.handledBy === "cloud")
    reasons.push("escalated, but escalation is forbidden");
  if (escalation === "expected" && result.handledBy !== "cloud")
    reasons.push("stayed on device, but escalation was expected");
  if (tools.join(",") !== fixture.tools.join(","))
    reasons.push(`tools [${tools}], wanted [${fixture.tools}]`);
  const answer = result.text.toLowerCase();
  for (const word of fixture.mentions ?? [])
    if (!answer.includes(word)) reasons.push(`answer lacks "${word}"`);
  for (const word of fixture.forbids ?? [])
    if (answer.includes(word)) reasons.push(`answer contains "${word}"`);
  const reason = result.trace.filter((event) => event.type === "escalate").at(-1)?.reason;
  if (fixture.expectedReason !== undefined && reason !== fixture.expectedReason)
    reasons.push(`escalation reason ${reason ?? "none"}, wanted ${fixture.expectedReason}`);
  if (!result.text.trim() && fixture.expectedReason === undefined)
    reasons.push("empty answer without an expected escalation reason");
  return reasons;
}
