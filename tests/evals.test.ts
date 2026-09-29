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

  test("escalation is forbidden by default for device fixtures, and pass^k needs every run", async () => {
    let call = 0;
    const report = await runEvals({
      runs: 2,
      fixtures: fixtures.filter((f) => f.id === "small-talk"),
      // First run answers on device; second run escalates.
      model: () => {
        call += 1;
        return call === 1
          ? fakeModel([{ json: { kind: "answer", brief: "reply" } }, { text: "Morning!" }])
          : fakeModel([{ json: { kind: "escalate", brief: "hand off" } }]);
      },
    });
    const outcome = report.outcomes[0];
    expect(outcome).toMatchObject({ pass: false, passes: 1, runs: 2 });
    expect(outcome?.reasons).toEqual(["Run 2: escalated, but escalation is forbidden"]);
    expect(formatReport(report)).toContain("(pass^2)");
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

test("reports an early failed attempt even when the final attempt succeeds", async () => {
  let attempt = 0;
  const report = await runEvals({
    runs: 2,
    fixtures: fixtures.filter((fixture) => fixture.id === "small-talk"),
    model: () =>
      ++attempt === 1
        ? fakeModel([{ json: { kind: "escalate", brief: "hand off" } }])
        : fakeModel([{ json: { kind: "answer", brief: "reply" } }, { text: "Hello" }]),
  });
  expect(report.outcomes[0]).toMatchObject({ pass: false, passes: 1 });
  expect(report.outcomes[0]?.reasons).toEqual(["Run 1: escalated, but escalation is forbidden"]);
  expect(report.outcomes[0]?.attempts).toHaveLength(2);
  expect(report).toMatchObject({ totalRuns: 2, onDevice: 1, escalated: 1, errors: 0 });
});

test("uses runtime token accounting and a fresh generation factory", async () => {
  let windows = 0;
  let tokens = 0;
  let generations = 0;
  const report = await runEvals({
    fixtures: fixtures.filter((fixture) => fixture.id === "small-talk"),
    model: () => () =>
      fakeModel([
        ++generations === 1 ? { json: { kind: "answer", brief: "reply" } } : { text: "Hello" },
      ]),
    window: async () => {
      windows++;
      return 8192;
    },
    countTokens: async () => {
      tokens++;
      return 100;
    },
    metadata: { device: "test", osVersion: "26.4", scripted: true },
  });
  expect(report.passed).toBe(1);
  expect(windows).toBe(1);
  expect(tokens).toBeGreaterThan(0);
  expect(generations).toBe(2);
  expect(report.metadata.device).toBe("test");
});

test("continues after an execution failure and preserves it as a failed attempt", async () => {
  let attempt = 0;
  const report = await runEvals({
    runs: 2,
    fixtures: fixtures.filter((fixture) => fixture.id === "small-talk"),
    model: () => {
      if (++attempt === 1) throw new Error("Native module unavailable");
      return fakeModel([{ json: { kind: "answer", brief: "reply" } }, { text: "Hello" }]);
    },
  });
  expect(report).toMatchObject({ passed: 0, errors: 1, onDevice: 1, totalRuns: 2 });
  expect(report.outcomes[0]?.reasons).toEqual([
    "Run 1: Execution failed: Native module unavailable",
  ]);
});

test.each([0, -1, 1.5, NaN, Infinity])("rejects invalid repeat count %s", async (runs) => {
  await expect(runEvals({ runs, fixtures, model: fakeModel([]) })).rejects.toThrow(
    "positive integer",
  );
});

test("evaluation cancellation rejects instead of being scored as a model failure", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    runEvals({ fixtures, model: fakeModel([]), signal: controller.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
});

test("guardrail fixtures require an explicit expected reason to accept an empty answer", async () => {
  const refusal = () => fakeModel([{ error: new Error("guardrail violation") }]);
  const fixture: Fixture = {
    id: "refusal",
    ask: "Refusal fixture",
    tools: [],
    handledBy: "device",
  };
  const unexpected = await runEvals({ fixtures: [fixture], model: refusal });
  expect(unexpected.passed).toBe(0);
  const expected = await runEvals({
    fixtures: [{ ...fixture, expectedReason: "guardrail" }],
    model: refusal,
  });
  expect(expected.passed).toBe(1);
});
