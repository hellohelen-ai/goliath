import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createGoliath, defineTool, inMemory } from "../src/index.js";
import { fakeModel } from "../src/testing/index.js";

const tasks: { title: string }[] = [{ title: "Buy milk" }, { title: "Call mom" }];

const listTasks = defineTool({
  name: "listTasks",
  description: "The user's open tasks.",
  parameters: z.object({}),
  execute: () => tasks,
});

const createTask = defineTool({
  name: "createTask",
  description: "Add a task.",
  parameters: z.object({ title: z.string() }),
  writes: true,
  execute: ({ title }) => {
    tasks.push({ title });
    return { ok: true, title };
  },
});

describe("runTurn", () => {
  test("list → create with confirm → answer, all on device", async () => {
    const model = fakeModel([
      { json: { kind: "tool", tool: "listTasks", brief: "see what is open" } },
      // listTasks has no parameters, so no worker call: Goliath runs it directly.
      { json: { kind: "tool", tool: "createTask", brief: "add buy eggs" } },
      { json: { title: "Buy eggs" } },
      { json: { kind: "answer", brief: "reply" } },
      { text: "Added Buy eggs. You now have three tasks." },
    ]);
    const confirms: string[] = [];
    const goliath = createGoliath({
      model,
      tools: { listTasks, createTask },
      confirm: async ({ tool }) => {
        confirms.push(tool);
        return true;
      },
    });

    const result = await goliath.run("add buy eggs to my list");

    expect(result.handledBy).toBe("device");
    expect(result.text).toBe("Added Buy eggs. You now have three tasks.");
    expect(result.steps.map((s) => s.kind)).toEqual(["tool", "tool", "answer"]);
    expect(result.steps[0]?.result).toBe("1. title: Buy milk\n2. title: Call mom");
    expect(confirms).toEqual(["createTask"]);
    expect(tasks.at(-1)?.title).toBe("Buy eggs");
    expect(model.remaining()).toBe(0);

    // The conductor's second prompt carried the compressed list, not raw JSON.
    const secondPlan = JSON.stringify(model.calls[1]?.prompt);
    expect(secondPlan).toContain("1. title: Buy milk");
    expect(secondPlan).not.toContain('{"title"');
  });

  test("a declined write is reported, not executed", async () => {
    const before = tasks.length;
    const model = fakeModel([
      { json: { kind: "tool", tool: "createTask", brief: "add a task" } },
      { json: { title: "Nope" } },
      { json: { kind: "answer", brief: "reply" } },
      { text: "Okay, I did not add it." },
    ]);
    const goliath = createGoliath({
      model,
      tools: { createTask },
      confirm: async () => false,
    });

    const result = await goliath.run("add nope");

    expect(tasks.length).toBe(before);
    expect(result.steps[0]?.skipped).toBe(true);
    expect(result.steps[0]?.result).toBe("declined by the user. Do not retry unless asked.");
    expect(result.trace.some((e) => e.type === "confirm" && e.approved === false)).toBe(true);
  });

  test("a repeated tool call escalates to the fallback with the step log", async () => {
    const model = fakeModel([
      { json: { kind: "tool", tool: "listTasks", brief: "look" } },
      { json: { kind: "tool", tool: "listTasks", brief: "look again" } },
      { text: "brief after cloud" },
    ]);
    let received: unknown;
    const goliath = createGoliath({
      model,
      tools: { listTasks },
      memory: inMemory({
        summary: "",
        recent: [
          { ask: "a", answer: "b", at: 0 },
          { ask: "c", answer: "d", at: 0 },
          { ask: "e", answer: "f", at: 0 },
        ],
      }),
      fallback: async (request) => {
        received = request;
        return { text: "The cloud finished it." };
      },
    });

    const result = await goliath.run("plan my week");

    expect(result.handledBy).toBe("cloud");
    expect(result.text).toBe("The cloud finished it.");
    expect(result.trace.at(-2)).toMatchObject({ type: "escalate", reason: "repeated-tool-call" });
    expect(received).toMatchObject({ reason: "repeated-tool-call", ask: "plan my week" });
    expect((received as { steps: unknown[] }).steps).toHaveLength(1);
  });

  test("an invalid plan is retried once, then escalates; no fallback returns empty", async () => {
    const model = fakeModel([{ text: "not json at all" }, { text: "still not json" }]);
    const goliath = createGoliath({ model, tools: { listTasks } });

    const result = await goliath.run("hello");

    expect(result.handledBy).toBe("device");
    expect(result.text).toBe("");
    expect(result.trace.at(-1)).toMatchObject({ type: "escalate", reason: "plan-invalid" });
    expect(model.calls).toHaveLength(2);
  });

  test("a plan that fails once and then parses carries on", async () => {
    const model = fakeModel([
      { text: "oops" },
      { json: { kind: "answer", brief: "reply" } },
      { text: "Hello." },
    ]);
    const goliath = createGoliath({ model, tools: { listTasks } });
    const result = await goliath.run("hello");
    expect(result.text).toBe("Hello.");
    expect(result.handledBy).toBe("device");
  });

  test("arguments that fail the schema escalate as tool-args-invalid", async () => {
    const model = fakeModel([
      { json: { kind: "tool", tool: "createTask", brief: "add" } },
      { text: "not an object" },
    ]);
    let reason: string | undefined;
    const goliath = createGoliath({
      model,
      tools: { createTask },
      fallback: async (request) => {
        reason = request.reason;
        return { text: "cloud" };
      },
    });
    const result = await goliath.run("add something");
    expect(result.handledBy).toBe("cloud");
    expect(reason).toBe("tool-args-invalid");
  });

  test("with no tools it answers directly and remembers", async () => {
    const memory = inMemory();
    const model = fakeModel([{ text: "Hi there." }]);
    const goliath = createGoliath({ model, memory });

    const result = await goliath.run("hi");

    expect(result.text).toBe("Hi there.");
    expect(model.calls).toHaveLength(1);
    const state = await memory.load();
    expect(state.recent).toHaveLength(1);
    expect(state.recent[0]).toMatchObject({ ask: "hi", answer: "Hi there." });
  });

  test("the step cap escalates before the conductor runs again", async () => {
    const model = fakeModel([
      { json: { kind: "tool", tool: "createTask", brief: "1" } },
      { json: { title: "one" } },
      { json: { kind: "tool", tool: "createTask", brief: "2" } },
      { json: { title: "two" } },
    ]);
    const goliath = createGoliath({
      model,
      tools: { createTask },
      maxSteps: 2,
      fallback: async () => ({ text: "cloud" }),
    });

    const result = await goliath.run("loop");

    expect(result.handledBy).toBe("cloud");
    expect(result.trace.some((e) => e.type === "escalate" && e.reason === "too-many-steps")).toBe(
      true,
    );
  });
});
