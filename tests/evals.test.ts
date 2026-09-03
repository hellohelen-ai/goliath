import { describe, expect, test } from "bun:test";
import { fixtures, type Fixture } from "../evals/fixtures.js";
import { formatReport, runEvals } from "../evals/run-evals.js";
import { fakeModel, type ScriptedReply } from "../src/testing/index.js";

/** A perfect on-device model, scripted per fixture, proves the runner scores correctly. */
const perfectScript = (fixture: Fixture): ScriptedReply[] => {
  const replies: ScriptedReply[] = [];
  if (fixture.handledBy === "cloud") {
    replies.push({ json: { kind: "escalate", brief: "too big for the phone" } });
    return replies;
  }
  for (const tool of fixture.tools) {
    replies.push({ json: { kind: "tool", tool, brief: `use ${tool}` } });
    if (tool === "createTask") replies.push({ json: { title: fixture.ask } });
  }
  replies.push({ json: { kind: "answer", brief: "reply" } });
  replies.push({ text: `Done: ${fixture.ask}. You had milk on the list.` });
  return replies;
};

describe("runEvals", () => {
  test("scores a perfect run as all pass and reports the split", async () => {
    const report = await runEvals({
      fixtures,
      model: (fixture) => fakeModel(perfectScript(fixture)),
    });
    expect(report.passed).toBe(report.total);
    expect(report.onDevice).toBe(fixtures.filter((f) => f.handledBy === "device").length);
    expect(formatReport(report)).toContain(`${report.total}/${report.total} passed`);
  });

  test("flags the wrong tool and a missing mention", async () => {
    const report = await runEvals({
      fixtures: fixtures.filter((f) => f.id === "add-task"),
      model: () =>
        fakeModel([
          { json: { kind: "tool", tool: "listTasks", brief: "look" } },
          { json: { kind: "answer", brief: "reply" } },
          { text: "Here is your list." },
        ]),
    });
    const outcome = report.outcomes[0];
    expect(outcome?.pass).toBe(false);
    expect(outcome?.reasons).toEqual([
      "tools [listTasks], wanted [createTask]",
      'answer lacks "eggs"',
    ]);
  });
});
