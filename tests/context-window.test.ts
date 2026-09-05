import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { clipTokens, estimateTokens } from "../src/budget.js";
import { createAgent, defineTool, inMemory, type FallbackRequest } from "../src/index.js";
import { fakeModel } from "../src/testing/index.js";
import { runAnswerStep } from "../src/worker.js";

const look = defineTool({
  name: "look",
  description: "Look.",
  parameters: z.object({}),
  execute: () => "found it",
});
const oldExchanges = Array.from({ length: 3 }, (_, at) => ({
  ask: `ask ${at}`,
  answer: `answer ${at}`,
  at,
}));

describe("context window protection", () => {
  test.each(["x".repeat(30_000), "漢".repeat(2000)])(
    "oversized asks stop before any model call",
    async (ask) => {
      const model = fakeModel([]);
      const result = await createAgent({ model }).run(ask);
      expect(model.calls).toHaveLength(0);
      expect(result.trace).toContainEqual(
        expect.objectContaining({ type: "escalate", reason: "context-budget" }),
      );
    },
  );

  test("an oversized planner prompt is rejected even after compaction", async () => {
    const model = fakeModel([]);
    let received: FallbackRequest | undefined;
    const result = await createAgent({
      model,
      tools: { look },
      facts: { document: "x".repeat(30_000) },
      fallback: async (request) => {
        received = request;
        return { text: "cloud answer" };
      },
    }).run("find it");
    expect(result.text).toBe("cloud answer");
    expect(received?.reason).toBe("context-budget");
    expect(received?.ask).toBe("find it");
    expect(model.calls).toHaveLength(0);
  });

  test("worker schema cost is counted before generating arguments or executing writes", async () => {
    const model = fakeModel([{ json: { kind: "tool", tool: "write", brief: "write it" } }]);
    let executions = 0;
    let confirmations = 0;
    const write = defineTool({
      name: "write",
      description: "Write.",
      writes: true,
      parameters: z.object({ value: z.string().describe("schema detail ".repeat(2000)) }),
      execute: () => {
        executions++;
        return "done";
      },
    });
    const result = await createAgent({
      model,
      tools: { write },
      confirm: async () => {
        confirmations++;
        return true;
      },
      fallback: async () => ({ text: "cloud answer" }),
    }).run("write hello");
    expect(result.handledBy).toBe("cloud");
    expect(model.calls).toHaveLength(1);
    expect(executions).toBe(0);
    expect(confirmations).toBe(0);
    expect(result.trace).toContainEqual(
      expect.objectContaining({ type: "budget", label: "worker" }),
    );
    expect(result.trace).toContainEqual(
      expect.objectContaining({ type: "escalate", reason: "context-budget" }),
    );
  });

  test("the configured 8k window admits an ask that cannot fit 4k", async () => {
    const ask = "x".repeat(12_000);
    const small = fakeModel([]);
    const large = fakeModel([{ text: "answer" }]);
    await createAgent({ model: small, window: 4096 }).run(ask);
    const result = await createAgent({ model: large, window: 8192 }).run(ask);
    expect(small.calls).toHaveLength(0);
    expect(result.text).toBe("answer");
    expect(large.calls[0]?.maxOutputTokens).toBe(384);
    expect(JSON.stringify(large.calls[0]?.prompt)).toContain(ask);
  });

  test("large custom tool output is bounded before the next planner sees it", async () => {
    const model = fakeModel([
      { json: { kind: "tool", tool: "look", brief: "look" } },
      { json: { kind: "answer", brief: "reply" } },
      { text: "found it" },
    ]);
    const result = await createAgent({
      model,
      tools: { look: { ...look, toModelOutput: () => "x".repeat(30_000) } },
    }).run("find it");
    expect(result.text).toBe("found it");
    expect(result.steps[0]?.result?.length).toBe(600);
    expect(JSON.stringify(model.calls[1]?.prompt)).not.toContain("x".repeat(601));
  });

  test("every stage caps output and reports its input budget", async () => {
    const model = fakeModel([
      { json: { kind: "tool", tool: "find", brief: "find hello" } },
      { json: { query: "hello" } },
      { json: { kind: "answer", brief: "reply" } },
      { text: "found hello" },
      { text: "updated memory" },
    ]);
    const find = defineTool({
      name: "find",
      description: "Find.",
      parameters: z.object({ query: z.string() }),
      execute: () => "hello",
    });
    const result = await createAgent({
      model,
      tools: { find },
      memory: inMemory({ summary: "old", recent: oldExchanges }),
    }).run("find hello");
    expect(result.text).toBe("found hello");
    expect(model.calls.map((call) => call.maxOutputTokens)).toEqual([256, 512, 256, 384, 192]);
    const budgets = result.trace.filter((event) => event.type === "budget");
    expect(budgets.map((event) => event.label)).toEqual([
      "conductor",
      "worker",
      "conductor",
      "answer",
      "scribe",
    ]);
    for (const event of budgets) expect(event.tokens).toBeLessThanOrEqual(event.limit);
  });

  test("best-effort answers also compact and cap their requests", async () => {
    const model = fakeModel([{ text: "partial answer" }]);
    const steps = Array.from({ length: 4 }, (_, index) => ({
      index,
      kind: "tool" as const,
      tool: "look",
      brief: "look",
      result: "first line\n" + "x".repeat(1400),
    }));
    const text = await runAnswerStep({
      model,
      instructions: "p",
      ask: "find it",
      summary: "",
      steps,
      window: 2048,
      bestEffort: true,
    });
    expect(text).toBe("partial answer");
    expect(model.calls[0]?.maxOutputTokens).toBe(384);
    expect(JSON.stringify(model.calls[0]?.prompt).split("x".repeat(1400))).toHaveLength(2);
    expect(steps[0]?.result?.length).toBeGreaterThan(1400);
  });

  test("budget rejections do not mark the device session as broken", async () => {
    const model = fakeModel([{ text: "hello" }]);
    const agent = createAgent({ model, fallback: async () => ({ text: "cloud answer" }) });
    for (let i = 0; i < 3; i++) await agent.run("x".repeat(30_000));
    expect(agent.sessionFallback).toBe(false);
    const result = await agent.run("hello");
    expect(result.text).toBe("hello");
    expect(result.handledBy).toBe("device");
    // The oversized evicted exchange cannot fit in the scribe either.
    expect(model.calls).toHaveLength(1);
  });

  test("a scribe failure preserves the completed answer and recent memory", async () => {
    const model = fakeModel([{ text: "completed answer" }]);
    const memory = inMemory({ summary: "previous brief", recent: oldExchanges });
    let fallbacks = 0;
    const result = await createAgent({
      model,
      memory,
      fallback: async () => {
        fallbacks++;
        return { text: "cloud" };
      },
    }).run("hello");
    expect(result.text).toBe("completed answer");
    expect(fallbacks).toBe(0);
    expect(result.trace).toContainEqual(expect.objectContaining({ type: "memory-error" }));
    const state = await memory.load();
    expect(state.summary).toBe("previous brief");
    expect(state.recent.at(-1)?.answer).toBe("completed answer");
  });

  test("a failed device session is not reused to remember a cloud answer", async () => {
    const model = fakeModel([]);
    const memory = inMemory({ summary: "previous brief", recent: oldExchanges });
    const result = await createAgent({
      model,
      memory,
      fallback: async () => ({ text: "cloud answer" }),
    }).run("hello");
    expect(result.text).toBe("cloud answer");
    expect(model.calls).toHaveLength(1);
    expect((await memory.load()).recent.at(-1)?.answer).toBe("cloud answer");
  });

  test("summary clipping obeys the estimator for English and Unicode", () => {
    for (const text of ["a".repeat(4000), "漢字😀".repeat(500)]) {
      for (const limit of [0, 1, 4, 128, 512]) {
        expect(estimateTokens(clipTokens(text, limit))).toBeLessThanOrEqual(limit);
      }
    }
    expect(estimateTokens("漢".repeat(100))).toBeGreaterThanOrEqual(100);
  });

  test.each([0, -1, NaN, Infinity, 0.5])("invalid windows fail at configuration: %s", (window) => {
    expect(() => createAgent({ model: fakeModel([]), window })).toThrow("positive integer");
  });
});
