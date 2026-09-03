import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createGoliath, defineTool } from "../src/index.js";
import { conductorUser, scribeSystem, stepsLeft, workerSystem } from "../src/prompts.js";
import { fakeModel } from "../src/testing/index.js";

const createTask = defineTool({
  name: "createTask",
  description: "Add a task.",
  parameters: z.object({ title: z.string() }),
  writes: true,
  execute: ({ title }) => ({ ok: true, title }),
});

describe("rules borrowed from other harnesses", () => {
  test("an empty answer gets one nudged retry before escalating (eve, OpenClaw, Hermes)", async () => {
    const model = fakeModel([{ text: "   " }, { text: "Here you go." }]);
    const goliath = createGoliath({ model, fallback: async () => ({ text: "cloud" }) });
    const result = await goliath.run("hi");
    expect(result.text).toBe("Here you go.");
    expect(result.handledBy).toBe("device");
    expect(model.calls).toHaveLength(2);
    expect(JSON.stringify(model.calls[1]?.prompt)).toContain("Your previous reply was empty");
  });

  test("two empty answers escalate", async () => {
    const model = fakeModel([{ text: "" }, { text: "" }]);
    const goliath = createGoliath({ model, fallback: async () => ({ text: "cloud" }) });
    const result = await goliath.run("hi");
    expect(result.handledBy).toBe("cloud");
    expect(result.trace.some((e) => e.type === "escalate" && e.reason === "empty-answer")).toBe(
      true,
    );
  });

  test("a declined write carries the user's reason into the step log (deepagents, Mastra)", async () => {
    const model = fakeModel([
      { json: { kind: "tool", tool: "createTask", brief: "add it" } },
      { json: { title: "Nope" } },
      { json: { kind: "answer", brief: "reply" } },
      { text: "Okay, not added." },
    ]);
    const goliath = createGoliath({
      model,
      tools: { createTask },
      confirm: async () => ({ approved: false, reason: "already have one" }),
    });
    const result = await goliath.run("add nope");
    expect(result.steps[0]?.result).toBe(
      "declined by the user: already have one. Do not retry unless asked.",
    );
    expect(result.trace).toContainEqual({
      type: "confirm",
      tool: "createTask",
      approved: false,
      reason: "already have one",
    });
    // The conductor's next prompt shows the decision.
    expect(JSON.stringify(model.calls[2]?.prompt)).toContain("already have one");
  });

  test("a tool can shape what the model sees (eve, Mastra toModelOutput)", async () => {
    const events = defineTool({
      name: "listEvents",
      description: "Today's events.",
      parameters: z.object({}),
      execute: () => Array.from({ length: 30 }, (_, i) => ({ id: i, title: `Event ${i}` })),
      toModelOutput: (out) => `${out.length} events, first: ${out[0]?.title}`,
    });
    const model = fakeModel([
      { json: { kind: "tool", tool: "listEvents", brief: "look" } },
      { json: { kind: "answer", brief: "reply" } },
      { text: "Thirty events." },
    ]);
    const goliath = createGoliath({ model, tools: { events } });
    const result = await goliath.run("what's on?");
    expect(result.steps[0]?.result).toBe("30 events, first: Event 0");
  });

  test("three turns of model errors flip the session to the cloud (Claude Code's 529 rule)", async () => {
    const dead = fakeModel([]);
    dead.doGenerate = async () => {
      throw new Error("guardrailViolation");
    };
    let fallbackCalls = 0;
    const goliath = createGoliath({
      model: dead,
      fallback: async () => {
        fallbackCalls += 1;
        return { text: "cloud" };
      },
    });
    for (let i = 0; i < 3; i += 1) await goliath.run("hi");
    expect(goliath.sessionFallback).toBe(true);
    const calls = dead.calls.length;
    const result = await goliath.run("hi again");
    expect(result.handledBy).toBe("cloud");
    expect(dead.calls.length).toBe(calls); // the device was not asked
    expect(fallbackCalls).toBe(4);
  });

  test("an empty tool output is named, never blank (Claude Code)", async () => {
    const quiet = defineTool({
      name: "quiet",
      description: "Says nothing.",
      parameters: z.object({}),
      execute: () => "",
    });
    const model = fakeModel([
      { json: { kind: "tool", tool: "quiet", brief: "run it" } },
      { json: { kind: "answer", brief: "reply" } },
      { text: "Nothing came back." },
    ]);
    const result = await createGoliath({ model, tools: { quiet } }).run("run quiet");
    expect(result.steps[0]?.result).toBe("(no output)");
  });

  test("the conductor sees the step budget and a finish hint at 80% (Hermes)", () => {
    expect(stepsLeft(0, 5)).toBe("Step 1 of 5.");
    expect(stepsLeft(4, 5)).toBe("Step 5 of 5: finish now.");
    expect(stepsLeft(5, 5)).toBe("No steps left: answer now.");
    const prompt = conductorUser({ ask: "x", summary: "", steps: [], maxSteps: 5 });
    expect(prompt).toContain("Step 1 of 5.");
  });

  test("prompt snapshots: worker forbids placeholders; scribe has five slots (deepagents)", () => {
    expect(workerSystem("You are Helen.", "add the task")).toBe(
      [
        "You are Helen.",
        "Do exactly this: add the task",
        "Fill in the arguments from the ask. Never use placeholders or guess a value you were not given; leave it out instead.",
      ].join("\n"),
    );
    for (const slot of ["Goal:", "Done:", "Decisions:", "Pending:", "Next:"]) {
      expect(scribeSystem).toContain(slot);
    }
    expect(scribeSystem).toContain("never list finished work as pending");
  });
});
