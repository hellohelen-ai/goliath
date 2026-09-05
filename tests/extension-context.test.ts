import { expect, test } from "bun:test";
import { z } from "zod";
import { createGoliath, defineTool, GoliathBudgetError, inMemory } from "../src/index.js";
import { fakeModel } from "../src/testing/index.js";

test("native budgeting counts extension context and finalizes a rejected request", async () => {
  const counted: string[] = [];
  const model = fakeModel([]);
  const lifecycle: string[] = [];
  let cloud = 0;
  const read = defineTool({
    name: "read",
    description: "Read a value.",
    parameters: z.object({}),
    execute: () => "value",
  });
  await expect(
    createGoliath({
      model,
      tools: { read },
      countTokens: (text) => {
        counted.push(text);
        return text.includes("extension context") ? 5000 : 100;
      },
      fallback: async () => {
        cloud++;
        return { text: "cloud" };
      },
      extensions: [
        {
          name: "context",
          beforePlan: () => ({ contextText: "extension context" }),
          onError: ({ origin }) => {
            lifecycle.push(origin);
          },
          onFinish: ({ outcome }) => {
            lifecycle.push(outcome.status);
          },
        },
      ],
    }).run("read"),
  ).rejects.toBeInstanceOf(GoliathBudgetError);
  expect(counted.length).toBeGreaterThan(0);
  expect(
    counted.every((text) => text.includes("extension context") && text.includes('"properties"')),
  ).toBe(true);
  expect(model.calls).toHaveLength(0);
  expect(cloud).toBe(0);
  expect(lifecycle).toEqual(["budget", "error"]);
});

test("extension memory and fallback patches preserve exact outputs outside device prompts", async () => {
  const raw = { id: "EXACT-PRIVATE-ID", payload: "raw ".repeat(1000) };
  const memory = inMemory();
  const read = defineTool({
    name: "read",
    description: "Read a value.",
    parameters: z.object({}),
    execute: () => raw,
    toModelOutput: () => "reference A",
  });
  const model = fakeModel([
    { json: { kind: "tool", tool: "read", brief: "read" } },
    { json: { kind: "answer", brief: "reply" } },
    { text: "Found A" },
    { json: { kind: "escalate", brief: "cloud" } },
  ]);
  let persisted = 0;
  const goliath = createGoliath({
    model,
    tools: { read },
    memory,
    fallback: async (request) => {
      expect(request.recent[0]?.steps?.[0]?.output).toEqual(raw);
      return { text: "Cloud answer" };
    },
    extensions: [
      {
        name: "copy",
        afterRecall: ({ memory }) => ({ memory }),
        afterTool: () => ({ result: "summary ".repeat(1000) }),
        beforeRemember: ({ memory }) => {
          persisted++;
          expect(memory.recent[0]?.steps?.[0]?.output).toEqual(raw);
          return { memory };
        },
        beforeFallback: ({ request }) => ({ request }),
      },
    ],
  });
  const first = await goliath.run("look up A");
  expect(first.steps[0]?.result?.length).toBeLessThanOrEqual(600);
  expect(first.steps[0]?.output).toEqual(raw);
  expect((await goliath.run("send it to cloud")).text).toBe("Cloud answer");
  expect(persisted).toBe(2);
  expect((await memory.load()).recent[0]?.steps?.[0]?.output).toEqual(raw);
  expect(JSON.stringify(model.calls)).not.toContain(raw.id);
  expect(JSON.stringify(model.calls)).not.toContain(raw.payload);
});

test("extension rewrites resolve to canonical IDs before duplicate writes are checked", async () => {
  let effects = 0;
  const confirmed: unknown[] = [];
  const raw = { id: "EXACT-ID", ref: "A" };
  const read = defineTool({
    name: "read",
    description: "Read a value.",
    parameters: z.object({}),
    execute: () => raw,
    toModelOutput: () => "A",
  });
  const write = defineTool({
    name: "write",
    description: "Update a reference.",
    parameters: z.object({ ref: z.string() }),
    writes: true,
    requires: ["read"],
    resolveInput: ({ ref }, context) => {
      expect(ref).toBe("A");
      expect(context.steps?.[0]?.output).toEqual(raw);
      return { ref: raw.id };
    },
    execute: ({ ref }) => {
      expect(ref).toBe(raw.id);
      effects++;
      return "done";
    },
  });
  const model = fakeModel([
    { json: { kind: "tool", tool: "read", brief: "read" } },
    { json: { kind: "tool", tool: "write", brief: "write" } },
    { json: { ref: "first alias" } },
    { json: { kind: "tool", tool: "write", brief: "write" } },
    { json: { ref: "second alias" } },
    { text: "Done" },
  ]);
  const result = await createGoliath({
    model,
    tools: { read, write },
    confirm: async ({ input }) => {
      confirmed.push(input);
      return true;
    },
    extensions: [
      {
        name: "references",
        beforeTool: ({ tool }) => (tool.name === "write" ? { input: { ref: "A" } } : undefined),
      },
    ],
  }).run("update A");
  expect(effects).toBe(1);
  expect(confirmed).toEqual([{ ref: raw.id }]);
  expect(result.trace).toContainEqual({ type: "escalate", reason: "repeated-tool-call" });
  expect(result.steps[1]?.input).toEqual({ ref: raw.id });
});
