import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createGoliath, defineTool, inMemory } from "../src/index.js";
import { fakeModel } from "../src/testing/index.js";
import { budgetPrompt } from "../src/budget.js";

describe("provider token accounting", () => {
  test("provider counts override the heuristic and detected capacity is read once per turn", async () => {
    let windows = 0;
    const model = fakeModel([{ text: "answer" }]);
    const ask = "x".repeat(12_000);
    const result = await createGoliath({
      model,
      window: async () => {
        windows++;
        return 4096;
      },
      countTokens: async () => 100,
    }).run(ask);
    expect(result.text).toBe("answer");
    expect(windows).toBe(1);
    expect(JSON.stringify(model.calls[0]?.prompt)).toContain(ask);
    expect(result.trace).toContainEqual({
      type: "budget",
      label: "answer",
      tokens: 108,
      limit: 2867,
      source: "tokenizer",
    });
  });

  test("native counts apply to every stage and a factory is invoked for every generation", async () => {
    const scripts = [
      [{ json: { kind: "tool", tool: "lookup", brief: "look" } }],
      [{ json: { name: "Alice" } }],
      [{ json: { kind: "answer", brief: "reply" } }],
      [{ text: "Found Alice" }],
      [{ text: "updated memory" }],
    ];
    let created = 0;
    const counted: string[] = [];
    const lookup = defineTool({
      name: "lookup",
      description: "Look up.",
      parameters: z.object({ name: z.string().describe("Exact contact name") }),
      execute: () => "found",
    });
    const result = await createGoliath({
      model: () => fakeModel(scripts[created++] ?? []),
      tools: { lookup },
      countTokens: async (text) => {
        counted.push(text);
        return 100;
      },
      memory: inMemory({
        summary: "old",
        recent: [1, 2, 3].map((at) => ({ ask: `ask ${at}`, answer: `answer ${at}`, at })),
      }),
    }).run("Find Alice");
    expect(result.text).toBe("Found Alice");
    expect(created).toBe(5);
    expect(counted).toHaveLength(5);
    expect(counted[0]).toContain('"properties"');
    expect(counted[1]).toContain("Exact contact name");
    expect(counted[4]).toContain("New exchange:");
    expect(
      result.trace.filter((e) => e.type === "budget").every((e) => e.source === "tokenizer"),
    ).toBe(true);
  });

  test("an oversized native count blocks the request despite a small character estimate", async () => {
    const model = fakeModel([]);
    const result = await createGoliath({ model, countTokens: async () => 5000 }).run("hi");
    expect(model.calls).toHaveLength(0);
    expect(result.trace).toContainEqual(
      expect.objectContaining({ type: "escalate", reason: "context-budget" }),
    );
  });

  test("compacted text is recounted by the provider", async () => {
    const counted: string[] = [];
    const prompt = await budgetPrompt({
      label: "test",
      window: 4096,
      maxOutputTokens: 256,
      system: "system",
      prompt: "too big",
      compact: () => "small",
      countTokens: async (text) => {
        counted.push(text);
        return text.includes("too big") ? 4000 : 100;
      },
    });
    expect(prompt).toBe("small");
    expect(counted).toEqual(["system\n\ntoo big", "system\n\nsmall"]);
  });

  test.each([NaN, -1, Infinity, 1.2])("invalid counts never reach the model", async (count) => {
    const model = fakeModel([]);
    const result = await createGoliath({ model, countTokens: () => count }).run("hi");
    expect(model.calls).toHaveLength(0);
    expect(result.trace).toContainEqual(
      expect.objectContaining({
        type: "escalate",
        reason: "model-error",
        error: expect.stringContaining("countTokens"),
      }),
    );
  });

  test("a failed tokenizer does not silently switch to an estimate", async () => {
    const model = fakeModel([]);
    const result = await createGoliath({
      model,
      countTokens: async () => {
        throw new Error("tokenizer unavailable");
      },
    }).run("hi");
    expect(model.calls).toHaveLength(0);
    expect(result.trace).toContainEqual(
      expect.objectContaining({ type: "escalate", reason: "model-error" }),
    );
  });

  test("invalid detected capacity rejects before generation", async () => {
    const model = fakeModel([]);
    await expect(createGoliath({ model, window: async () => 0 }).run("hi")).rejects.toThrow(
      "positive integer",
    );
    expect(model.calls).toHaveLength(0);
  });

  test("a cancelled queued turn does not touch the model, and the queue recovers", async () => {
    const controller = new AbortController();
    controller.abort();
    const model = fakeModel([{ text: "Hello" }]);
    const goliath = createGoliath({ model });
    await expect(goliath.run("cancel", { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect((await goliath.run("hello")).text).toBe("Hello");
    expect(model.calls).toHaveLength(1);
  });
});
