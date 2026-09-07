import { describe, expect, expectTypeOf, test } from "bun:test";
import { z } from "zod";
import {
  createAgent,
  defineTool,
  GoliathBudgetError,
  inMemory,
  type GoliathConfig,
  type RunResult,
} from "../src/index.js";
import { fakeModel } from "../src/testing/index.js";

const schema = z.object({ reply: z.string(), action: z.enum(["rest", "walk"]) });
const value = { reply: "Take a short walk.", action: "walk" as const };
const read = defineTool({
  name: "read",
  description: "Read the activity log.",
  parameters: z.object({}),
  execute: () => "No activity today",
});

// Checked by tsc without issuing model calls.
const checkTypes = async () => {
  const agent = createAgent({ model: fakeModel([]), outputSchema: schema });
  expectTypeOf(await agent.run("coach me")).toEqualTypeOf<RunResult<z.infer<typeof schema>>>();
  const override = z.object({ count: z.number() });
  expectTypeOf(await agent.run("count", { outputSchema: override })).toEqualTypeOf<
    RunResult<{ count: number }>
  >();
  // @ts-expect-error A different output type requires a schema override.
  void agent.run<{ count: number }>("count");
  const config: GoliathConfig<{ user: string }, z.infer<typeof schema>> = {
    model: fakeModel([]),
    outputSchema: schema,
  };
  const contextual = createAgent(config);
  expectTypeOf(await contextual.run("coach me", { context: { user: "alice" } })).toEqualTypeOf<
    RunResult<z.infer<typeof schema>>
  >();
  // @ts-expect-error Schema overrides must still supply required application context.
  void contextual.run("count", { outputSchema: override });
  // @ts-expect-error Context shape remains checked for schema overrides.
  void contextual.run("count", { outputSchema: override, context: { user: 1 } });
  expectTypeOf(
    await contextual.run("count", { outputSchema: override, context: { user: "alice" } }),
  ).toEqualTypeOf<RunResult<{ count: number }>>();
};
void checkTypes;

describe("structured answers", () => {
  test("generates a typed device answer from tool results in the existing answer call", async () => {
    const memory = inMemory();
    const model = fakeModel([
      { json: { kind: "tool", tool: "read", brief: "check activity" } },
      { json: { kind: "answer", brief: "coach" } },
      { json: value },
    ]);
    const result = await createAgent({
      model,
      tools: { read },
      memory,
      outputSchema: schema,
    }).run("coach me");
    expectTypeOf(result.output).toEqualTypeOf<z.infer<typeof schema> | undefined>();
    expect(result.output).toEqual(value);
    expect(result.handledBy).toBe("device");
    expect(result.text).toBe(JSON.stringify(value));
    expect(result.steps.at(-1)?.text).toBe(result.text);
    expect(result.trace).toContainEqual({ type: "answer", text: result.text });
    expect((await memory.load()).recent[0]?.answer).toBe(result.text);
    expect(model.calls).toHaveLength(3);
    expect(model.remaining()).toBe(0);
    const call = model.calls[2]!;
    expect(call.responseFormat).toMatchObject({ type: "json" });
    expect(JSON.stringify(call.responseFormat)).toContain('"action"');
    expect(JSON.stringify(call.prompt)).toContain("No activity today");
    expect(JSON.stringify(call.prompt)).toContain("supplied JSON schema");
    expect(JSON.stringify(call.prompt)).not.toContain("two or three short sentences");
    expect(call.maxOutputTokens).toBe(384);
  });

  test("per-run schemas override the default without changing later turns", async () => {
    const model = fakeModel([{ json: { count: 2 } }, { json: value }]);
    const agent = createAgent({ model, outputSchema: schema });
    const [first, second] = await Promise.all([
      agent.run("count", { outputSchema: z.object({ count: z.number() }) }),
      agent.run("coach me"),
    ]);
    expect(first.output).toEqual({ count: 2 });
    expect(second.output).toEqual(value);
    expect(JSON.stringify(model.calls[0]?.responseFormat)).not.toContain('"action"');
    expect(JSON.stringify(model.calls[1]?.responseFormat)).toContain('"action"');
  });

  test("opting in for one call leaves subsequent prose calls unchanged", async () => {
    const model = fakeModel([{ json: value }, { text: "Hello." }]);
    const agent = createAgent({ model });
    expect((await agent.run("coach me", { outputSchema: schema })).output).toEqual(value);
    const plain = await agent.run("hello");
    expect(plain.text).toBe("Hello.");
    expect(plain).not.toHaveProperty("output");
    expect(model.calls).toHaveLength(2);
    expect(model.calls[1]?.responseFormat?.type).not.toBe("json");
  });

  test.each([{ text: "not JSON" }, { json: { reply: "hello", action: "run" } }])(
    "retries malformed or schema-invalid answers once with guidance",
    async (invalid) => {
      const model = fakeModel([invalid, { json: value }]);
      let factories = 0;
      const result = await createAgent({
        model: () => {
          factories++;
          return model;
        },
        outputSchema: schema,
      }).run("coach me");
      expect(result.output).toEqual(value);
      expect(factories).toBe(2);
      expect(model.calls).toHaveLength(2);
      expect(JSON.stringify(model.calls[1]?.prompt)).toContain("Your last reply was not valid");
      expect(result.trace.filter((event) => event.type === "budget")).toHaveLength(2);
    },
  );

  test("two invalid answers escalate to text-only cloud fallback", async () => {
    const model = fakeModel([{ text: "bad" }, { json: { action: "invalid" } }]);
    const result = await createAgent({
      model,
      outputSchema: schema,
      fallback: async (request) => {
        expect(request.reason).toBe("answer-invalid");
        return { text: "Cloud reply", output: value };
      },
    }).run("coach me");
    expect(result.handledBy).toBe("cloud");
    expect(result.text).toBe("Cloud reply");
    expect(result).not.toHaveProperty("output");
    expect(model.calls).toHaveLength(2);
  });

  test("without fallback, invalid answers stop after two calls and do not affect device health", async () => {
    const model = fakeModel(Array.from({ length: 6 }, () => ({ text: "bad" })));
    const memory = inMemory();
    const agent = createAgent({ model, outputSchema: schema, memory });
    for (let i = 0; i < 3; i++) {
      const result = await agent.run("coach me");
      expect(result.text).toBe("");
      expect(result).not.toHaveProperty("output");
      expect(result.trace).toContainEqual({ type: "escalate", reason: "answer-invalid" });
    }
    expect(agent.sessionFallback).toBe(false);
    expect(model.calls).toHaveLength(6);
    expect((await memory.load()).recent).toEqual([]);
  });

  test("best-effort device answers honor the schema and retry once", async () => {
    const model = fakeModel([{ text: "bad" }, { json: value }]);
    const result = await createAgent({ model, outputSchema: schema, maxSteps: 0 }).run("coach");
    expect(result.bestEffort).toBe(true);
    expect(result.output).toEqual(value);
    expect(model.calls).toHaveLength(2);
    expect(JSON.stringify(model.calls[0]?.prompt)).toContain(
      "Do not claim unfinished actions succeeded",
    );
  });

  test("invalid best-effort output never leaks into the result", async () => {
    const model = fakeModel([{ text: "bad" }, { text: "still bad" }]);
    const result = await createAgent({ model, outputSchema: schema, maxSteps: 0 }).run("coach");
    expect(result.text).toBe("");
    expect(result).not.toHaveProperty("output");
    expect(result.trace).toContainEqual({ type: "escalate", reason: "answer-invalid" });
    expect(model.calls).toHaveLength(2);
  });

  test("native accounting includes the answer schema and rejects it before generation", async () => {
    const model = fakeModel([]);
    const counted: string[] = [];
    const result = await createAgent({
      model,
      outputSchema: schema,
      countTokens: (text) => {
        counted.push(text);
        return text.includes('"action"') ? 5000 : 100;
      },
      fallback: async ({ reason }) => {
        expect(reason).toBe("context-budget");
        return { text: "Cloud" };
      },
    }).run("coach");
    expect(counted.every((text) => text.includes('"action"'))).toBe(true);
    expect(counted.length).toBeGreaterThan(0);
    expect(model.calls).toHaveLength(0);
    expect(result).not.toHaveProperty("output");
  });

  test("estimated schema budgets preserve extension error and finish hooks", async () => {
    const model = fakeModel([]);
    const phases: string[] = [];
    await expect(
      createAgent({
        model,
        outputSchema: z.object({ value: z.string().describe("large ".repeat(3000)) }),
        extensions: [
          {
            name: "observe",
            onError: ({ origin }) => {
              phases.push(origin);
            },
            onFinish: ({ outcome }) => {
              phases.push(outcome.status);
            },
          },
        ],
      }).run("coach"),
    ).rejects.toBeInstanceOf(GoliathBudgetError);
    expect(phases).toEqual(["budget", "error"]);
    expect(model.calls).toHaveLength(0);
  });

  test("validates transforms exactly once and retains original JSON text", async () => {
    let transforms = 0;
    const outputSchema = z.object({
      count: z.number().transform((count) => {
        transforms++;
        return String(count + 1);
      }),
    });
    const result = await createAgent({
      model: fakeModel([{ json: { count: 2 } }]),
      outputSchema,
    }).run("count");
    expectTypeOf(result.output).toEqualTypeOf<{ count: string } | undefined>();
    expect(result.output).toEqual({ count: "3" });
    expect(result.text).toBe('{"count":2}');
    expect(transforms).toBe(1);
  });

  test("text hooks and memory failures preserve validated output; stops omit it", async () => {
    for (const stop of [false, true]) {
      const result = await createAgent({
        model: fakeModel([{ json: value }]),
        outputSchema: schema,
        memory: {
          load: async () => ({ summary: "", recent: [] }),
          save: async () => {
            throw new Error("offline");
          },
        },
        extensions: [
          {
            name: "display",
            afterAnswer: () =>
              stop
                ? { action: "stop", text: "Stopped", reason: "policy" }
                : { text: "Go for a walk." },
            onFinish: ({ outcome }) => {
              if (outcome.status === "completed") expect(outcome.result.output).toEqual(value);
            },
          },
        ],
      }).run("coach");
      if (stop) {
        expect(result).not.toHaveProperty("output");
        expect(result.stopped?.reason).toBe("policy");
      } else {
        expect(result.output).toEqual(value);
        expect(result.text).toBe("Go for a walk.");
        expect(result.trace.some((event) => event.type === "memory-error")).toBe(true);
        expect(result.diagnostics).toBeUndefined();
      }
    }
  });

  test("provider errors are not retried and session fallback remains text-only", async () => {
    let calls = 0;
    const agent = createAgent({
      model: () => {
        calls++;
        throw new Error("unavailable");
      },
      outputSchema: schema,
      fallback: async () => ({ text: "Cloud" }),
    });
    for (let i = 0; i < 4; i++) {
      const result = await agent.run("coach");
      expect(result.handledBy).toBe("cloud");
      expect(result).not.toHaveProperty("output");
    }
    expect(calls).toBe(3);
    expect(agent.sessionFallback).toBe(true);
  });

  test("cancellation before a structured retry aborts without fallback", async () => {
    const abort = new AbortController();
    const model = fakeModel([{ text: "bad" }]);
    let budgets = 0;
    let cloud = 0;
    await expect(
      createAgent({
        model,
        outputSchema: schema,
        onEvent: (event) => {
          if (event.type === "budget" && ++budgets === 2) abort.abort();
        },
        fallback: async () => {
          cloud++;
          return { text: "cloud" };
        },
      }).run("coach", { signal: abort.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(cloud).toBe(0);
    expect(model.calls).toHaveLength(1);
  });
});
