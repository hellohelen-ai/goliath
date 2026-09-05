import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createAgent, defineTool, inMemory, type StepRecord } from "../src/index.js";
import { fakeModel } from "../src/testing/index.js";
import { recentContext } from "../src/context.js";
import { estimateTokens } from "../src/budget.js";

const toolPlan = (tool: string) => ({ json: { kind: "tool", tool, brief: "do it" } });
const answerPlan = { json: { kind: "answer", brief: "reply" } };

describe("task context and execution boundaries", () => {
  test("the next turn can read the preceding exchange before it reaches the scribe", async () => {
    const model = fakeModel([
      { text: "Your address is 42 Birch Lane." },
      { text: "42 Birch Lane" },
    ]);
    const agent = createAgent({ model });
    await agent.run("My address is 42 Birch Lane.");
    await agent.run("What address did I just give you?");
    expect(JSON.stringify(model.calls[1]?.prompt)).toContain("42 Birch Lane");
    expect(model.calls).toHaveLength(2);
  });

  test("a duplicate write never reaches confirmation or execution a second time", async () => {
    let writes = 0;
    let approvals = 0;
    const add = defineTool({
      name: "add",
      description: "Add.",
      parameters: z.object({ title: z.string() }),
      writes: true,
      execute: () => {
        writes++;
        return "added";
      },
    });
    const model = fakeModel([
      toolPlan("add"),
      { json: { title: "dentist" } },
      toolPlan("add"),
      { json: { title: "dentist" } },
    ]);
    const result = await createAgent({
      model,
      tools: { add },
      confirm: async () => {
        approvals++;
        return true;
      },
      fallback: async () => ({ text: "stopped" }),
    }).run("Add dentist");
    expect(writes).toBe(1);
    expect(approvals).toBe(1);
    expect(result.steps).toHaveLength(1);
    expect(result.trace).toContainEqual(
      expect.objectContaining({ type: "escalate", reason: "repeated-tool-call" }),
    );
  });

  test("reordered keys and tool mutation cannot evade the duplicate check", async () => {
    let writes = 0;
    const add = defineTool({
      name: "add",
      description: "Add.",
      parameters: z.object({ values: z.record(z.string(), z.string()) }),
      writes: true,
      execute: (args) => {
        writes++;
        args.values.x = "mutated";
        return "added";
      },
    });
    const model = fakeModel([
      toolPlan("add"),
      { json: { values: { a: "1", b: "2" } } },
      toolPlan("add"),
      { json: { values: { b: "2", a: "1" } } },
    ]);
    const result = await createAgent({
      model,
      tools: { add },
      fallback: async () => ({ text: "stopped" }),
    }).run("Add");
    expect(writes).toBe(1);
    expect(result.steps[0]?.input).toEqual({ values: { a: "1", b: "2" } });
  });

  test("declined writes are not offered again in the same turn", async () => {
    let approvals = 0;
    let writes = 0;
    const add = defineTool({
      name: "add",
      description: "Add.",
      parameters: z.object({}),
      writes: true,
      execute: () => {
        writes++;
      },
    });
    const result = await createAgent({
      model: fakeModel([toolPlan("add"), toolPlan("add")]),
      tools: { add },
      confirm: async () => {
        approvals++;
        return false;
      },
      fallback: async () => ({ text: "stopped" }),
    }).run("Add");
    expect(approvals).toBe(1);
    expect(writes).toBe(0);
    expect(result.steps[0]?.skipped).toBe(true);
  });

  test("a successful read with arguments can be reused once without executing again", async () => {
    let reads = 0;
    const find = defineTool({
      name: "find",
      description: "Find.",
      parameters: z.object({ query: z.string() }),
      execute: () => {
        reads++;
        return { id: "42" };
      },
    });
    const model = fakeModel([
      toolPlan("find"),
      { json: { query: "Alice" } },
      toolPlan("find"),
      { json: { query: "Alice" } },
      answerPlan,
      { text: "Found Alice" },
    ]);
    const result = await createAgent({ model, tools: { find } }).run("Find Alice");
    expect(reads).toBe(1);
    expect(result.steps[1]).toMatchObject({ cached: true, output: { id: "42" } });
  });

  test("full results support exact bindings without entering the model context", async () => {
    const exactId = "long-id-" + "x".repeat(1000);
    let sent: unknown;
    let approved: unknown;
    const memory = inMemory();
    const lookup = defineTool({
      name: "lookup",
      description: "Find contact.",
      parameters: z.object({}),
      execute: () => ({ id: exactId, name: "Alice" }),
      toModelOutput: () => "Contact reference: alice",
    });
    const send = defineTool({
      name: "send",
      description: "Send to a contact reference.",
      parameters: z.object({ contact: z.string() }),
      writes: true,
      requires: ["lookup"],
      resolveInput: (args, context) => {
        if (args.contact !== "alice") throw new Error("Unknown reference");
        const result = context.steps?.find((step) => step.tool === "lookup")?.output;
        return { contact: z.object({ id: z.string() }).parse(result).id };
      },
      execute: (args) => {
        sent = args;
        return "sent";
      },
    });
    const model = fakeModel([
      toolPlan("lookup"),
      toolPlan("send"),
      { json: { contact: "alice" } },
      answerPlan,
      { text: "Sent" },
    ]);
    const result = await createAgent({
      model,
      tools: { lookup, send },
      memory,
      confirm: async ({ input }) => {
        approved = input;
        return true;
      },
    }).run("Send to Alice");
    expect(sent).toEqual({ contact: exactId });
    expect(approved).toEqual(sent);
    expect(JSON.stringify(model.calls)).not.toContain(exactId);
    expect(JSON.stringify(model.calls[2]?.prompt)).toContain("Contact reference: alice");
    expect(result.steps[0]?.output).toEqual({ id: exactId, name: "Alice" });
    expect((await memory.load()).recent[0]?.steps?.[0]?.output).toEqual(result.steps[0]?.output);
  });

  test("resolved arguments are validated before confirmation", async () => {
    let writes = 0;
    let approvals = 0;
    const add = defineTool({
      name: "add",
      description: "Add.",
      parameters: z.object({ title: z.string().min(1) }),
      writes: true,
      resolveInput: () => ({ title: "" }),
      execute: () => {
        writes++;
      },
    });
    await createAgent({
      model: fakeModel([toolPlan("add"), { json: { title: "valid" } }]),
      tools: { add },
      confirm: async () => {
        approvals++;
        return true;
      },
      fallback: async () => ({ text: "stopped" }),
    }).run("Add");
    expect(writes).toBe(0);
    expect(approvals).toBe(0);
  });

  test("a required lookup must succeed before a write is attempted", async () => {
    let writes = 0;
    const send = defineTool({
      name: "send",
      description: "Send.",
      parameters: z.object({}),
      requires: ["lookup"],
      writes: true,
      execute: () => {
        writes++;
      },
    });
    const result = await createAgent({
      model: fakeModel([toolPlan("send")]),
      tools: { send },
      fallback: async () => ({ text: "stopped" }),
    }).run("Send");
    expect(writes).toBe(0);
    expect(result.trace).toContainEqual(
      expect.objectContaining({ type: "escalate", reason: "tool-prerequisite-missing" }),
    );
  });

  test("cancellation during confirmation prevents execution", async () => {
    const controller = new AbortController();
    let writes = 0;
    const add = defineTool({
      name: "add",
      description: "Add.",
      parameters: z.object({}),
      writes: true,
      execute: () => {
        writes++;
      },
    });
    const agent = createAgent({
      model: fakeModel([toolPlan("add")]),
      tools: { add },
      confirm: async () => {
        controller.abort();
        return true;
      },
    });
    await expect(agent.run("Add", { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(writes).toBe(0);
  });

  test("a formatter failure cannot erase a completed write", async () => {
    const add = defineTool({
      name: "add",
      description: "Add.",
      parameters: z.object({}),
      writes: true,
      execute: () => ({ id: 42 }),
      toModelOutput: () => {
        throw new Error("format failed");
      },
    });
    const result = await createAgent({
      model: fakeModel([toolPlan("add"), answerPlan, { text: "Added" }]),
      tools: { add },
    }).run("Add");
    expect(result.text).toBe("Added");
    expect(result.steps[0]).toMatchObject({
      output: { id: 42 },
      result: "completed (result could not be summarized)",
    });
  });

  test("a failed memory save preserves the answer without invoking fallback", async () => {
    let fallbacks = 0;
    const result = await createAgent({
      model: fakeModel([{ text: "Done" }]),
      memory: {
        load: async () => ({ summary: "", recent: [] }),
        save: async () => {
          throw new Error("disk full");
        },
      },
      fallback: async () => {
        fallbacks++;
        return { text: "cloud" };
      },
    }).run("Hi");
    expect(result.text).toBe("Done");
    expect(fallbacks).toBe(0);
    expect(result.trace).toContainEqual({ type: "memory-error", error: "Error: disk full" });
  });

  test("a failed fallback is not called twice", async () => {
    let calls = 0;
    const lookup = defineTool({
      name: "lookup",
      description: "Look.",
      parameters: z.object({}),
      execute: () => "found",
    });
    const agent = createAgent({
      model: fakeModel([{ json: { kind: "escalate", brief: "beyond tools" } }]),
      tools: { lookup },
      fallback: async () => {
        calls++;
        throw new Error("offline");
      },
    });
    await expect(agent.run("Help")).rejects.toThrow("offline");
    expect(calls).toBe(1);
  });

  test("overlapping runs are serialized and see the preceding memory", async () => {
    const model = fakeModel([{ text: "My name is Alice" }, { text: "Hello Alice" }]);
    const agent = createAgent({ model });
    const results = await Promise.all([
      agent.run("My name is Alice"),
      agent.run("What is my name?"),
    ]);
    expect(results[1]?.text).toBe("Hello Alice");
    expect(JSON.stringify(model.calls[1]?.prompt)).toContain("My name is Alice");
  });

  test("recent context is bounded and excludes full outputs", () => {
    const steps: StepRecord[] = [
      {
        index: 0,
        kind: "tool",
        brief: "send",
        tool: "send",
        input: { id: 1 },
        result: "sent",
        output: { hidden: "RAW_OUTPUT" },
      },
    ];
    const context = recentContext([{ ask: "x".repeat(20_000), answer: "Sent", at: 1, steps }], 512);
    expect(estimateTokens(context)).toBeLessThanOrEqual(512);
    expect(context).toContain("Assistant: Sent");
    expect(context).toContain("[completed]");
    expect(context).not.toContain("RAW_OUTPUT");
  });
});

test("a write invalidates an earlier cached read", async () => {
  let reads = 0;
  const read = defineTool({
    name: "read",
    description: "Read.",
    parameters: z.object({}),
    execute: () => {
      reads++;
      return reads;
    },
  });
  const write = defineTool({
    name: "write",
    description: "Write.",
    parameters: z.object({}),
    writes: true,
    execute: () => "changed",
  });
  const model = fakeModel([
    toolPlan("read"),
    toolPlan("write"),
    toolPlan("read"),
    answerPlan,
    { text: "Updated" },
  ]);
  const result = await createAgent({ model, tools: { read, write } }).run(
    "Read, update, and check",
  );
  expect(reads).toBe(2);
  expect(result.steps[2]?.cached).toBeUndefined();
});

test("two references resolving to the same write are detected as duplicates", async () => {
  let writes = 0;
  const write = defineTool({
    name: "write",
    description: "Write.",
    parameters: z.object({ id: z.string() }),
    resolveInput: () => ({ id: "canonical-id" }),
    writes: true,
    execute: () => {
      writes++;
      return "done";
    },
  });
  const model = fakeModel([
    toolPlan("write"),
    { json: { id: "first-alias" } },
    toolPlan("write"),
    { json: { id: "second-alias" } },
  ]);
  await createAgent({ model, tools: { write }, fallback: async () => ({ text: "stopped" }) }).run(
    "Write",
  );
  expect(writes).toBe(1);
});

test("eviction gives the scribe recorded actions without their full outputs", async () => {
  const memory = inMemory({
    summary: "",
    recent: [
      {
        ask: "Send",
        answer: "Done",
        at: 0,
        steps: [
          {
            index: 0,
            kind: "tool",
            brief: "send",
            tool: "send",
            input: { id: 42 },
            result: "sent",
            output: { hidden: "RAW_PAYLOAD" },
          },
        ],
      },
      { ask: "hello", answer: "hi", at: 1 },
      { ask: "hello again", answer: "hi", at: 2 },
    ],
  });
  const model = fakeModel([{ text: "Hi" }, { text: "Sent to 42" }]);
  await createAgent({ model, memory }).run("Hello");
  const prompt = JSON.stringify(model.calls[1]?.prompt);
  expect(prompt).toContain("[completed]");
  expect(prompt).toContain("sent");
  expect(prompt).not.toContain("RAW_PAYLOAD");
});
