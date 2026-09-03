import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { plan, trimSteps } from "../src/conductor.js";
import { defineTool, type StepRecord } from "../src/index.js";
import { fakeModel } from "../src/testing/index.js";

const look = defineTool({
  name: "look",
  description: "Look.",
  parameters: z.object({}),
  execute: () => "x",
});

const bigStep = (i: number): StepRecord => ({
  index: i,
  kind: "tool",
  brief: "look",
  tool: "look",
  input: {},
  result: Array.from(
    { length: 8 },
    (_, n) => `${n + 1}. title: item ${i}-${n} ${"x".repeat(60)}`,
  ).join("\n"),
});

describe("conductor budget", () => {
  test("trimSteps clips every result but the newest to one line", () => {
    const trimmed = trimSteps([bigStep(0), bigStep(1), bigStep(2)]);
    expect(trimmed[0]?.result?.includes("\n")).toBe(false);
    expect(trimmed[0]?.result?.length).toBeLessThanOrEqual(100);
    expect(trimmed[2]?.result).toBe(bigStep(2).result);
  });

  test("over the share of the window, the prompt is trimmed and a budget event fires", async () => {
    const model = fakeModel([{ json: { kind: "answer", brief: "reply" } }]);
    const events: unknown[] = [];
    const steps = [bigStep(0), bigStep(1), bigStep(2), bigStep(3)];
    const outcome = await plan({
      model,
      persona: "p",
      tools: { look },
      ask: "what is open?",
      summary: "",
      steps,
      maxSteps: 5,
      window: 1024,
      emit: (e) => events.push(e),
    });
    expect(outcome.ok).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "budget", label: "conductor", limit: 716 });
    const sent = JSON.stringify(model.calls[0]?.prompt);
    expect(sent).toContain("item 3-7");
    expect(sent).not.toContain("item 0-7");
  });

  test("under the share, nothing is trimmed and no event fires", async () => {
    const model = fakeModel([{ json: { kind: "answer", brief: "reply" } }]);
    const events: unknown[] = [];
    await plan({
      model,
      persona: "p",
      tools: { look },
      ask: "hi",
      summary: "",
      steps: [bigStep(0)],
      maxSteps: 5,
      window: 4096,
      emit: (e) => events.push(e),
    });
    expect(events).toHaveLength(0);
    expect(JSON.stringify(model.calls[0]?.prompt)).toContain("item 0-7");
  });
});
