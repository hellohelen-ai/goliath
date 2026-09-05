import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  createGoliath,
  defineTool,
  inMemory,
  estimateTokens,
  GoliathExtensionError,
  GoliathBudgetError,
  type GoliathExtension,
  type RunOutcome,
  type FallbackRequest,
  type ToolOutcome,
} from "../src/index.js";
import { fakeModel } from "../src/testing/index.js";

const read = defineTool({
  name: "read",
  description: "Read a value.",
  parameters: z.object({}),
  execute: () => ({ secret: "private", value: 7 }),
});
const planRead = { json: { kind: "tool", tool: "read", brief: "read it" } };
const planAnswer = { json: { kind: "answer", brief: "reply" } };
const modelAnswer = { text: "Seven." };
const stop = { action: "stop" as const, text: "Stopped.", reason: "test-policy" };

// Compile-time checks: context is required only for callers choosing a concrete type.
const checkContextTypes = () => {
  const typed = createGoliath<{ user: string }>({ model: fakeModel([]) });
  // @ts-expect-error A typed application context is required.
  void typed.run("hello");
  // @ts-expect-error Context cannot have the wrong shape.
  void typed.run("hello", { context: { user: 123 } });
  void typed.run("hello", { context: { user: "alice" } });
  void createGoliath({ model: fakeModel([]) }).run("hello");
};
void checkContextTypes;

describe("lifecycle extensions", () => {
  test("async transformations run in order and final text agrees across result, trace, steps, and memory", async () => {
    const order: string[] = [];
    const memory = inMemory();
    const model = fakeModel([planAnswer, modelAnswer]);
    const result = await createGoliath({
      model,
      tools: { read },
      memory,
      extensions: [
        {
          name: "first",
          beforeRun: async () => {
            await Promise.resolve();
            order.push("start1");
            return { ask: "changed ask", instructions: "Be precise.", facts: { zone: "east" } };
          },
          afterAnswer: ({ text }) => {
            order.push("answer1");
            return { text: `${text} First.` };
          },
        },
        {
          name: "second",
          beforeRun: ({ ask, facts }) => {
            expect(ask).toBe("changed ask");
            expect(facts.zone).toBe("east");
            order.push("start2");
          },
          afterAnswer: ({ text }) => {
            order.push("answer2");
            return { text: `${text} Second.` };
          },
        },
      ],
    }).run("original ask");
    expect(order).toEqual(["start1", "start2", "answer1", "answer2"]);
    expect(result.text).toBe("Seven. First. Second.");
    expect(result.steps.at(-1)?.text).toBe(result.text);
    expect(result.trace.find((e) => e.type === "answer")).toEqual({
      type: "answer",
      text: result.text,
    });
    expect((await memory.load()).recent[0]).toMatchObject({
      ask: "changed ask",
      answer: result.text,
    });
    expect(JSON.stringify(model.calls[0]?.prompt)).toContain("zone: east");
    expect(JSON.stringify(model.calls[0]?.prompt)).toContain("Be precise.");
  });

  test("run context and private state are isolated across overlapping runs and never injected", async () => {
    const states = new Set<Map<string, unknown>>();
    const ids = new Set<string>();
    let arrived = 0;
    let release!: () => void;
    const both = new Promise<void>((resolve) => {
      release = resolve;
    });
    const extension: GoliathExtension<{ secret: string }> = {
      name: "isolation",
      async beforeRun({ state, context, runId }) {
        expect(state.size).toBe(0);
        state.set("secret", context.secret);
        states.add(state);
        ids.add(runId);
        if (++arrived === 2) release();
        await both;
      },
      afterAnswer({ state, context }) {
        expect(state.get("secret")).toBe(context.secret);
      },
    };
    const model = fakeModel([modelAnswer, modelAnswer]);
    const goliath = createGoliath({ model, extensions: [extension] });
    const results = await Promise.all([
      goliath.run("one", { context: { secret: "PRIVATE-A" } }),
      goliath.run("two", { context: { secret: "PRIVATE-B" } }),
    ]);
    expect(states.size).toBe(2);
    expect(ids.size).toBe(2);
    expect(JSON.stringify(model.calls)).not.toContain("PRIVATE");
    expect(JSON.stringify(results)).not.toContain("PRIVATE");
  });

  test("recall transformations are transient and snapshots cannot mutate the persistence base", async () => {
    const memory = inMemory({ summary: "original", recent: [] });
    const model = fakeModel([modelAnswer]);
    await createGoliath({
      model,
      memory,
      extensions: [
        {
          name: "recall",
          afterRecall({ memory }) {
            (memory as { summary: string }).summary = "mutation";
            return { memory: { summary: "transient", recent: [] } };
          },
        },
      ],
    }).run("hi");
    expect(JSON.stringify(model.calls[0]?.prompt)).toContain("transient");
    expect((await memory.load()).summary).toBe("original");
  });

  test("tool filtering is intersection-only, includes synthetic plans, and prevents plan reinsertion", async () => {
    const model = fakeModel([modelAnswer]);
    const goliath = createGoliath({
      model,
      tools: { read },
      extensions: [
        { name: "filter", beforePlan: () => ({ tools: [] }) },
        {
          name: "reinsert",
          beforePlan: () => ({ tools: ["read"] }),
          afterPlan: ({ tools, plan }) => {
            expect(tools).toHaveLength(0);
            expect(plan.kind).toBe("answer");
            return { plan: { kind: "tool", tool: "read", brief: "bypass" } };
          },
        },
      ],
    });
    await expect(goliath.run("hi")).rejects.toMatchObject({
      name: "GoliathExtensionError",
      phase: "afterPlan",
      extension: "reinsert",
    });
    expect(model.calls).toHaveLength(0);
  });

  test("planning context reaches the prompt and attempt numbers identify malformed-plan retries", async () => {
    const attempts: number[] = [];
    const model = fakeModel([{ text: "invalid" }, planAnswer, modelAnswer]);
    await createGoliath({
      model,
      tools: { read },
      extensions: [
        {
          name: "planner",
          beforePlan: ({ attempt }) => {
            attempts.push(attempt);
            return { contextText: "Prefer a brief answer." };
          },
        },
      ],
    }).run("hi");
    expect(attempts).toEqual([0, 1]);
    expect(JSON.stringify(model.calls[0]?.prompt)).toContain("Prefer a brief answer.");
  });

  test("rewritten arguments are validated, confirmed, and executed once with application context", async () => {
    const observed: unknown[] = [];
    const write = defineTool({
      name: "write",
      description: "Write a value.",
      writes: true,
      parameters: z.object({ value: z.number().min(0) }),
      execute: (args, context) => {
        observed.push(args, context.context);
        return "done";
      },
    });
    const model = fakeModel([
      { json: { kind: "tool", tool: "write", brief: "write" } },
      { json: { value: 1 } },
      planAnswer,
      modelAnswer,
    ]);
    await createGoliath<{ user: string }>({
      model,
      tools: { write },
      confirm: async (request) => {
        observed.push(request.input);
        (request.input as { value: number }).value = 99; // Approval must not alter the approved call.
        return true;
      },
      extensions: [{ name: "rewrite", beforeTool: () => ({ input: { value: 2 } }) }],
    }).run("write", { context: { user: "alice" } });
    expect(observed).toEqual([{ value: 99 }, { value: 2 }, { user: "alice" }]);
  });

  test("invalid argument rewrites fail before confirmation, execution, or cloud fallback", async () => {
    let calls = 0;
    const write = defineTool({
      name: "write",
      description: "Write.",
      writes: true,
      parameters: z.object({ value: z.number() }),
      execute: () => {
        calls++;
      },
    });
    const model = fakeModel([
      { json: { kind: "tool", tool: "write", brief: "write" } },
      { json: { value: 1 } },
    ]);
    const goliath = createGoliath({
      model,
      tools: { write },
      confirm: async () => {
        calls++;
        return true;
      },
      fallback: async () => {
        calls++;
        return { text: "cloud" };
      },
      extensions: [{ name: "bad", beforeTool: () => ({ input: { value: "invalid" } }) }],
    });
    await expect(goliath.run("write")).rejects.toBeInstanceOf(GoliathExtensionError);
    expect(calls).toBe(0);
    expect(goliath.sessionFallback).toBe(false);
  });

  test("denial ends the chain and records policy provenance for no-argument tools", async () => {
    let later = 0;
    let executed = 0;
    const tool = {
      ...read,
      execute: () => {
        executed++;
        return "secret";
      },
    };
    const outcomes: ToolOutcome["status"][] = [];
    const result = await createGoliath({
      model: fakeModel([planRead, planAnswer, modelAnswer]),
      tools: { tool },
      extensions: [
        {
          name: "deny",
          beforeTool: () => ({ action: "deny", reason: "private data" }),
          afterTool: ({ outcome }) => {
            outcomes.push(outcome.status);
          },
        },
        {
          name: "later",
          beforeTool: () => {
            later++;
          },
        },
      ],
    }).run("read");
    expect(later).toBe(0);
    expect(executed).toBe(0);
    expect(outcomes).toEqual(["skipped"]);
    expect(result.steps[0]).toMatchObject({
      skipped: true,
      skipReason: "policy",
      extension: "deny",
    });
    expect(result.steps[0]?.result).toContain("private data");
  });

  test("cached reads are gated and report a distinct outcome with no raw output", async () => {
    let before = 0;
    let executed = 0;
    const outcomes: string[] = [];
    const tool = {
      ...read,
      execute: () => {
        executed++;
        return "value";
      },
    };
    const result = await createGoliath({
      model: fakeModel([planRead, planRead, planRead, planAnswer, modelAnswer]),
      tools: { tool },
      maxSteps: 5,
      extensions: [
        {
          name: "cache-policy",
          beforeTool: () => {
            if (++before === 3) return { action: "deny", reason: "revoked" };
          },
          afterTool: ({ outcome }) => {
            outcomes.push(outcome.status);
            if (outcome.status === "cached") expect("output" in outcome).toBe(false);
          },
        },
      ],
    }).run("read");
    expect(before).toBe(3);
    expect(executed).toBe(1);
    expect(outcomes).toEqual(["executed", "cached", "skipped"]);
    expect(result.steps[2]?.skipReason).toBe("policy");
  });

  test.each(["failed", "skipped"] as const)(
    "a %s read is never reused as a cached success",
    async (status) => {
      let before = 0;
      const tool = {
        ...read,
        execute: () => {
          if (status === "failed") throw new Error("down");
          return "value";
        },
      };
      const result = await createGoliath({
        model: fakeModel([planRead, planRead]),
        tools: { tool },
        fallback: async () => ({ text: "cloud" }),
        extensions: [
          {
            name: "gate",
            beforeTool: () => {
              if (++before === 1 && status === "skipped") return { action: "deny", reason: "no" };
            },
          },
        ],
      }).run("read");
      expect(result.steps.some((step) => step.cached)).toBe(false);
      expect(result.trace).toContainEqual({ type: "escalate", reason: "repeated-tool-call" });
    },
  );

  test("successful output is transformed before the transcript and trace, and capped", async () => {
    const model = fakeModel([planRead, planAnswer, modelAnswer]);
    const result = await createGoliath({
      model,
      tools: { read },
      extensions: [
        {
          name: "redact",
          afterTool: ({ outcome }) => {
            expect(outcome.status).toBe("executed");
            if (outcome.status === "executed")
              expect(outcome.output).toEqual({ secret: "private", value: 7 });
            return { result: "public ".repeat(200) };
          },
        },
      ],
    }).run("read");
    expect(result.steps[0]?.result?.length).toBeLessThanOrEqual(600);
    expect(JSON.stringify(result.trace)).not.toContain("private");
    expect(JSON.stringify(model.calls)).not.toContain("private");
  });

  test("a duplicate write is caught before its second confirmation and effect", async () => {
    let writes = 0;
    let confirms = 0;
    const write = defineTool({
      name: "write",
      description: "Write.",
      writes: true,
      parameters: z.object({}),
      execute: () => {
        writes++;
        return "done";
      },
    });
    const pick = { json: { kind: "tool", tool: "write", brief: "write" } };
    const result = await createGoliath({
      model: fakeModel([pick, pick]),
      tools: { write },
      confirm: async () => {
        confirms++;
        return true;
      },
      fallback: async () => ({ text: "cloud" }),
    }).run("write");
    expect(writes).toBe(1);
    expect(confirms).toBe(1);
    expect(result.handledBy).toBe("cloud");
  });

  test("fallback payload transformations do not mutate local steps or persist redacted recall", async () => {
    const memory = inMemory({ summary: "local secret", recent: [] });
    let received: FallbackRequest | undefined;
    const result = await createGoliath({
      model: fakeModel([]),
      memory,
      maxSteps: 0,
      fallback: async (request) => {
        received = request;
        return { text: "cloud" };
      },
      extensions: [
        {
          name: "cloud-redaction",
          beforeFallback: ({ request }) => ({
            request: { ...request, ask: "redacted", summary: "", recent: [], steps: [] },
          }),
          afterAnswer: ({ text }) => ({ text: `${text}!` }),
        },
      ],
    }).run("original");
    expect(received).toMatchObject({ ask: "redacted", summary: "", steps: [] });
    expect(result.text).toBe("cloud!");
    expect((await memory.load()).summary).toBe("local secret");
    expect((await memory.load()).recent[0]).toMatchObject({ ask: "original", answer: "cloud!" });
  });

  test("session fallback still runs start, recall, cloud policy, answer, memory and finish without a device call", async () => {
    const phases: string[] = [];
    const model = fakeModel([]);
    let calls = 0;
    let cloud = 0;
    let deny = false;
    model.doGenerate = async () => {
      calls++;
      throw new Error("device unavailable");
    };
    const memory = inMemory();
    const goliath = createGoliath({
      model,
      memory,
      fallback: async () => {
        cloud++;
        return { text: "cloud" };
      },
      extensions: [
        {
          name: "all",
          beforeRun: () => {
            phases.push("start");
          },
          afterRecall: () => {
            phases.push("recall");
          },
          beforeFallback: () => {
            phases.push("fallback");
            if (deny) return stop;
          },
          afterAnswer: () => {
            phases.push("answer");
          },
          beforeRemember: () => {
            phases.push("memory");
          },
          onFinish: () => {
            phases.push("finish");
          },
        },
      ],
    });
    for (let i = 0; i < 3; i++) await goliath.run(`turn ${i}`);
    expect(goliath.sessionFallback).toBe(true);
    phases.length = 0;
    const result = await goliath.run("fourth");
    expect(phases).toEqual(["start", "recall", "fallback", "answer", "memory", "finish"]);
    expect(calls).toBe(3);
    expect(cloud).toBe(4);
    expect(result.trace.map((e) => e.type)).toEqual(["recall", "escalate", "answer", "remember"]);
    expect((await memory.load()).recent.map((e) => e.ask)).toEqual(["turn 1", "turn 2", "fourth"]);
    deny = true;
    const stopped = await goliath.run("fifth");
    expect(stopped.stopped?.phase).toBe("beforeFallback");
    expect(cloud).toBe(4);
    expect(calls).toBe(3);
    expect((await memory.load()).recent.at(-1)?.ask).toBe("fourth");
  });

  test("a stop skips persistence and reaches every finalizer exactly once", async () => {
    const completed: RunOutcome[] = [];
    let loads = 0;
    let later = 0;
    const result = await createGoliath({
      model: fakeModel([]),
      memory: {
        load: async () => {
          loads++;
          return { summary: "", recent: [] };
        },
        save: async () => {
          throw new Error("must not save");
        },
      },
      extensions: [
        {
          name: "stop",
          beforeRun: () => stop,
          onFinish: ({ outcome }) => {
            completed.push(outcome as RunOutcome);
          },
        },
        {
          name: "later",
          beforeRun: () => {
            later++;
          },
          onFinish: ({ outcome }) => {
            completed.push(outcome as RunOutcome);
          },
        },
      ],
    }).run("hi");
    expect(result.stopped).toEqual({
      extension: "stop",
      phase: "beforeRun",
      reason: "test-policy",
    });
    expect(loads).toBe(0);
    expect(later).toBe(0);
    expect(completed.map((o) => o.status)).toEqual(["stopped", "stopped"]);
  });

  test("memory transforms are validated and bounded, and skip is terminal", async () => {
    const memory = inMemory();
    await createGoliath({
      model: fakeModel([modelAnswer]),
      memory,
      extensions: [
        {
          name: "memory",
          beforeRemember: ({ exchange }) => ({
            memory: {
              summary: "x".repeat(10000),
              recent: Array.from({ length: 8 }, () => ({ ...exchange })),
            },
          }),
        },
      ],
    }).run("hi");
    expect(estimateTokens((await memory.load()).summary)).toBeLessThanOrEqual(512);
    expect((await memory.load()).recent).toHaveLength(3);
    let later = false;
    await createGoliath({
      model: fakeModel([modelAnswer]),
      memory: inMemory(),
      extensions: [
        { name: "skip", beforeRemember: () => ({ action: "skip" }) },
        {
          name: "later",
          beforeRemember: () => {
            later = true;
          },
        },
      ],
    }).run("hi");
    expect(later).toBe(false);
  });

  test("oversized extension context fails before the provider and never falls back", async () => {
    const model = fakeModel([modelAnswer]);
    let cloud = 0;
    await expect(
      createGoliath({
        model,
        fallback: async () => {
          cloud++;
          return { text: "cloud" };
        },
        extensions: [{ name: "too-big", beforeRun: () => ({ instructions: "x".repeat(20000) }) }],
      }).run("hi"),
    ).rejects.toBeInstanceOf(GoliathBudgetError);
    expect(model.calls).toHaveLength(0);
    expect(cloud).toBe(0);
  });

  test("empty answer transformations are extension failures, with no model retry or cloud call", async () => {
    const model = fakeModel([modelAnswer]);
    let cloud = 0;
    await expect(
      createGoliath({
        model,
        fallback: async () => {
          cloud++;
          return { text: "cloud" };
        },
        extensions: [{ name: "empty", afterAnswer: () => ({ text: " " }) }],
      }).run("hi"),
    ).rejects.toMatchObject({ extension: "empty", phase: "afterAnswer" });
    expect(model.calls).toHaveLength(1);
    expect(cloud).toBe(0);
  });

  test("cancellation after an awaited hook prevents execution and still finalizes", async () => {
    const controller = new AbortController();
    let writes = 0;
    let finished: string | undefined;
    const tool = {
      ...read,
      execute: () => {
        writes++;
        return "done";
      },
    };
    await expect(
      createGoliath({
        model: fakeModel([planRead]),
        tools: { tool },
        extensions: [
          {
            name: "cancel",
            beforeTool: async () => {
              await Promise.resolve();
              controller.abort("user cancelled");
            },
            onFinish: ({ outcome }) => {
              finished = outcome.status;
            },
          },
        ],
      }).run("read", { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(writes).toBe(0);
    expect(finished).toBe("aborted");
  });

  test("already-aborted runs skip start and recall but notify errors and finalizers", async () => {
    const controller = new AbortController();
    controller.abort();
    const phases: string[] = [];
    await expect(
      createGoliath({
        model: fakeModel([]),
        extensions: [
          {
            name: "abort",
            beforeRun: () => {
              phases.push("start");
            },
            onError: () => {
              phases.push("error");
            },
            onFinish: () => {
              phases.push("finish");
            },
          },
        ],
      }).run("hi", { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(phases).toEqual(["error", "finish"]);
  });

  test("cleanup failures preserve successful outcomes and report secondary diagnostics", async () => {
    const order: number[] = [];
    const result = await createGoliath({
      model: fakeModel([modelAnswer]),
      extensions: [
        {
          name: "bad",
          onFinish: () => {
            order.push(1);
            throw new Error("cleanup");
          },
        },
        {
          name: "good",
          onFinish: ({ diagnostics }) => {
            order.push(2);
            expect(diagnostics[0]?.extension).toBe("bad");
          },
        },
      ],
    }).run("hi");
    expect(order).toEqual([1, 2]);
    expect(result.text).toBe("Seven.");
    expect(result.diagnostics?.[0]?.phase).toBe("onFinish");
  });

  test("hook failure after a write preserves execution evidence and never repeats the effect", async () => {
    let calls = 0;
    let cloud = 0;
    let final: RunOutcome | undefined;
    const tool = {
      ...read,
      writes: true,
      execute: () => {
        calls++;
        return "private output";
      },
    };
    const goliath = createGoliath({
      model: fakeModel([planRead]),
      tools: { tool },
      fallback: async () => {
        cloud++;
        return { text: "cloud" };
      },
      extensions: [
        {
          name: "broken",
          afterTool: () => {
            throw new Error("formatter failed");
          },
          onError: () => {
            throw new Error("observer failed");
          },
          onFinish: ({ outcome, diagnostics }) => {
            final = outcome as RunOutcome;
            expect(diagnostics).toHaveLength(1);
          },
        },
      ],
    });
    await expect(goliath.run("read")).rejects.toMatchObject({
      name: "GoliathExtensionError",
      extension: "broken",
      phase: "afterTool",
    });
    expect(calls).toBe(1);
    expect(cloud).toBe(0);
    expect(final?.status).toBe("error");
    if (final && "steps" in final)
      expect(final.steps[0]?.result).toBe("(tool executed; output processing did not complete)");
  });

  test.each(["memory", "confirm", "formatter", "event", "fallback"] as const)(
    "%s failures reject with original provenance and cannot trigger a second route",
    async (origin) => {
      const failure = new Error("application safety failure");
      let cloud = 0;
      let observed: string | undefined;
      const tool = {
        ...read,
        writes: true,
        toModelOutput: () => {
          if (origin === "formatter") throw failure;
          return "value";
        },
      };
      const goliath = createGoliath({
        model: fakeModel(origin === "fallback" ? [] : [planRead, planAnswer, modelAnswer]),
        tools: { tool },
        maxSteps: origin === "fallback" ? 0 : 5,
        memory:
          origin === "memory"
            ? {
                load: async () => ({ summary: "", recent: [] }),
                save: async () => {
                  throw failure;
                },
              }
            : inMemory(),
        confirm: async () => {
          if (origin === "confirm") throw failure;
          return true;
        },
        onEvent: () => {
          if (origin === "event") throw failure;
        },
        fallback: async () => {
          cloud++;
          throw failure;
        },
        extensions: [
          {
            name: "audit",
            onError: ({ origin }) => {
              observed = origin;
            },
            onFinish: () => {
              throw new Error("secondary");
            },
          },
        ],
      });
      await expect(goliath.run("read")).rejects.toBe(failure);
      expect(observed).toBe(origin);
      expect(cloud).toBe(origin === "fallback" ? 1 : 0);
      expect(goliath.sessionFallback).toBe(false);
    },
  );

  test("guardrail exits and best-effort answers have correct finalization", async () => {
    const finishes: string[] = [];
    let answers = 0;
    let cloud = 0;
    const extension: GoliathExtension = {
      name: "audit",
      afterAnswer: () => {
        answers++;
      },
      onFinish: ({ outcome }) => {
        finishes.push(outcome.status);
      },
    };
    const guarded = fakeModel([]);
    guarded.doGenerate = async () => {
      throw new Error("guardrailViolation");
    };
    await createGoliath({
      model: guarded,
      extensions: [extension],
      fallback: async () => {
        cloud++;
        return { text: "cloud" };
      },
    }).run("hi");
    expect(answers).toBe(0);
    expect(cloud).toBe(0);
    const result = await createGoliath({
      model: fakeModel([modelAnswer]),
      maxSteps: 0,
      extensions: [extension],
    }).run("hi");
    expect(result.bestEffort).toBe(true);
    expect(answers).toBe(1);
    expect(finishes).toEqual(["completed", "completed"]);
  });

  test("duplicate extension names fail at configuration time", () => {
    expect(() =>
      createGoliath({ model: fakeModel([]), extensions: [{ name: "same" }, { name: "same" }] }),
    ).toThrow("unique");
  });
});

describe("extension edge paths", () => {
  test.each(["afterPlan", "beforeTool", "beforeFallback", "afterAnswer"] as const)(
    "%s stops bypass persistence and subsequent work",
    async (phase) => {
      let saved = 0;
      let cloud = 0;
      let ran = 0;
      let finalized = 0;
      const tool = {
        ...read,
        execute: () => {
          ran++;
          return "value";
        },
      };
      const model = fakeModel(
        phase === "beforeFallback"
          ? []
          : phase === "afterAnswer"
            ? [planAnswer, modelAnswer]
            : [planRead],
      );
      const result = await createGoliath({
        model,
        tools: { tool },
        maxSteps: phase === "beforeFallback" ? 0 : 5,
        memory: {
          load: async () => ({ summary: "", recent: [] }),
          save: async () => {
            saved++;
          },
        },
        fallback: async () => {
          cloud++;
          return { text: "cloud" };
        },
        extensions: [
          {
            name: "stop",
            [phase]: () => stop,
            onFinish: () => {
              finalized++;
            },
          },
        ],
      }).run("hi");
      expect(result.stopped?.phase).toBe(phase);
      expect(saved).toBe(0);
      expect(cloud).toBe(0);
      expect(ran).toBe(0);
      expect(finalized).toBe(1);
    },
  );

  test("readonly hook snapshots can be spread into replacement payloads", async () => {
    const result = await createGoliath({
      model: fakeModel([]),
      maxSteps: 0,
      fallback: async (request) => ({ text: request.ask }),
      extensions: [
        {
          name: "spread",
          afterRecall: ({ memory }) => ({ memory: { ...memory, summary: "brief" } }),
          beforeFallback: ({ request }) => ({ request: { ...request, ask: "redacted" } }),
          beforeRemember: ({ memory }) => ({ memory: { ...memory, summary: "saved" } }),
        },
      ],
    }).run("hi");
    expect(result.text).toBe("redacted");
  });

  test("a valid replacement plan dispatches its chosen action", async () => {
    const model = fakeModel([planRead, modelAnswer]);
    const result = await createGoliath({
      model,
      tools: { read },
      extensions: [
        {
          name: "answer",
          afterPlan: () => ({ plan: { kind: "answer", brief: "answer directly" } }),
        },
      ],
    }).run("hi");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({ kind: "answer", brief: "answer directly" });
  });

  test("prototype property names are not registered tools", async () => {
    await expect(
      createGoliath({
        model: fakeModel([planAnswer]),
        tools: { read },
        extensions: [
          {
            name: "invalid",
            afterPlan: () => ({ plan: { kind: "tool", tool: "toString", brief: "bad" } }),
          },
        ],
      }).run("hi"),
    ).rejects.toMatchObject({ extension: "invalid", phase: "afterPlan" });
  });

  test("changed arguments discard a potential cached read", async () => {
    let count = 0;
    const inputs: unknown[] = [];
    const tool = {
      ...read,
      parameters: z.object({}).catchall(z.string()),
      execute: (input: unknown) => {
        inputs.push(input);
        return "value";
      },
    };
    await createGoliath({
      model: fakeModel([planRead, planRead, planAnswer, modelAnswer]),
      tools: { tool },
      extensions: [
        {
          name: "rewrite",
          beforeTool: () => {
            if (++count === 2) return { input: { filter: "new" } };
          },
        },
      ],
    }).run("hi");
    expect(inputs).toEqual([{}, { filter: "new" }]);
  });

  test("missing arguments and declined confirmations are distinct afterTool outcomes", async () => {
    const seen: unknown[] = [];
    const tool = defineTool({
      name: "write",
      description: "Write.",
      writes: true,
      parameters: z.object({ value: z.string() }),
      execute: () => "done",
    });
    const pick = { json: { kind: "tool", tool: "write", brief: "write" } };
    let gates = 0;
    const extension: GoliathExtension = {
      name: "audit",
      beforeTool: () => {
        gates++;
      },
      afterTool: ({ outcome }) => {
        seen.push(outcome);
      },
    };
    await createGoliath({
      model: fakeModel([pick, { json: { value: "", missing: "value" } }, planAnswer, modelAnswer]),
      tools: { tool },
      extensions: [extension],
    }).run("hi");
    await createGoliath({
      model: fakeModel([pick, { json: { value: "x" } }, planAnswer, modelAnswer]),
      tools: { tool },
      confirm: async () => false,
      extensions: [extension],
    }).run("hi");
    expect(gates).toBe(1);
    expect(seen).toEqual([
      { status: "skipped", reason: "missing" },
      { status: "skipped", reason: "confirmation" },
    ]);
  });

  test("memory load and facts failures finalize without a device or cloud call", async () => {
    for (const origin of ["memory", "config"] as const) {
      const failure = new Error("failed");
      const model = fakeModel([]);
      let finalized = 0;
      let observed: string | undefined;
      await expect(
        createGoliath({
          model,
          memory: {
            load: async () => {
              if (origin === "memory") throw failure;
              return { summary: "", recent: [] };
            },
            save: async () => {},
          },
          facts: () => {
            if (origin === "config") throw failure;
            return {};
          },
          extensions: [
            {
              name: "audit",
              onError: ({ origin }) => {
                observed = origin;
              },
              onFinish: () => {
                finalized++;
              },
            },
          ],
        }).run("hi"),
      ).rejects.toBe(failure);
      expect(observed).toBe(origin);
      expect(finalized).toBe(1);
      expect(model.calls).toHaveLength(0);
    }
  });

  test("a scribe failure after an answer does not call fallback", async () => {
    const memory = inMemory({
      summary: "old",
      recent: Array.from({ length: 3 }, () => ({ ask: "a", answer: "b", at: 0 })),
    });
    let cloud = 0;
    let observed: string | undefined;
    const model = fakeModel([modelAnswer]); // The scribe exhausts the script.
    await expect(
      createGoliath({
        model,
        memory,
        fallback: async () => {
          cloud++;
          return { text: "cloud" };
        },
        extensions: [
          {
            name: "audit",
            onError: ({ origin }) => {
              observed = origin;
            },
          },
        ],
      }).run("hi"),
    ).rejects.toThrow("script exhausted");
    expect(cloud).toBe(0);
    expect(observed).toBe("model");
    expect((await memory.load()).recent.at(-1)?.ask).toBe("a");
  });

  test("provider aborts retain model provenance and the original rejection", async () => {
    const failure = new Error("cancelled");
    failure.name = "AbortError";
    const model = fakeModel([]);
    model.doGenerate = async () => {
      throw failure;
    };
    let origin: string | undefined;
    let status: string | undefined;
    await expect(
      createGoliath({
        model,
        extensions: [
          {
            name: "audit",
            onError: (data) => {
              origin = data.origin;
            },
            onFinish: ({ outcome }) => {
              status = outcome.status;
            },
          },
        ],
      }).run("hi"),
    ).rejects.toBe(failure);
    expect(origin).toBe("model");
    expect(status).toBe("aborted");
  });

  test("invalid configuration cannot disable the step or prompt limits accidentally", () => {
    expect(() => createGoliath({ model: fakeModel([]), maxSteps: NaN })).toThrow("maxSteps");
    expect(() => createGoliath({ model: fakeModel([]), window: Infinity })).toThrow("window");
  });
});
