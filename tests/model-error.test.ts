import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { NoObjectGeneratedError } from "ai";
import { createAgent, defineTool, inMemory } from "../src/index.js";
import { fakeModel } from "../src/testing/index.js";

const ping = defineTool({
  name: "ping",
  description: "Ping a host.",
  parameters: z.object({ host: z.string() }),
  execute: () => "pong",
});

describe("model errors", () => {
  test("a structured-output wrapper does not turn a provider outage into a validation retry", async () => {
    const error = new NoObjectGeneratedError({
      cause: Object.assign(new Error("Offline"), { code: "MODEL_UNAVAILABLE" }),
      response: { id: "test", timestamp: new Date(), modelId: "test" },
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        inputTokenDetails: { noCacheTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
      },
      finishReason: "error",
    });
    const model = fakeModel([{ error }]);
    const result = await createAgent({
      model,
      tools: { ping },
      fallback: async ({ reason }) => {
        expect(reason).toBe("model-unavailable");
        return { text: "Recovered" };
      },
    }).run("Ping localhost");
    expect(result.text).toBe("Recovered");
    expect(model.calls).toHaveLength(1);
  });

  test.each([
    ["CONTEXT_WINDOW_EXCEEDED", "context-budget"],
    ["MODEL_UNAVAILABLE", "model-unavailable"],
    ["UNSUPPORTED_OS", "model-unavailable"],
  ] as const)("classifies wrapped %s without relying on English messages", async (code, reason) => {
    const native = Object.assign(new Error("Modèle indisponible"), { code });
    const model = fakeModel([{ error: new Error("Provider failed", { cause: native }) }]);
    const memory = inMemory();
    await memory.save({
      summary: "Keep this summary.",
      recent: [1, 2, 3].map((at) => ({ ask: "Hello", answer: "Hi", at })),
    });
    const agent = createAgent({
      model,
      memory,
      fallback: async (request) => {
        expect(request.reason).toBe(reason);
        return { text: "Fallback reply" };
      },
    });
    const result = await agent.run("Hello");
    expect(result.handledBy).toBe("cloud");
    expect(model.calls).toHaveLength(1); // No retry or scribe on the failed model.
    expect((await memory.load()).summary).toBe("Keep this summary.");
    expect(agent.sessionFallback).toBe(false);
  });

  test("an unavailable model is not called again for a best-effort answer", async () => {
    const model = fakeModel([
      { error: Object.assign(new Error("Unavailable"), { code: "MODEL_UNAVAILABLE" }) },
    ]);
    const result = await createAgent({ model }).run("Hello");
    expect(result.text).toBe("");
    expect(model.calls).toHaveLength(1);
    expect(result.trace).toContainEqual({
      type: "escalate",
      reason: "model-unavailable",
      error: "Error: Unavailable",
    });
  });

  test("a nested refusal code takes priority over overflow and never invokes fallback", async () => {
    const native = Object.assign(new Error("Contenu refusé"), { code: "GUARDRAIL_VIOLATION" });
    // A malformed provider chain must terminate, while preserving the refusal.
    const wrapped = Object.assign(new Error("Failed", { cause: native }), {
      code: "CONTEXT_WINDOW_EXCEEDED",
    });
    Object.assign(native, { cause: wrapped });
    const model = fakeModel([{ error: wrapped }]);
    let fallbacks = 0;
    const result = await createAgent({
      model,
      fallback: async () => {
        fallbacks++;
        return { text: "Unexpected" };
      },
    }).run("Hello");
    expect(fallbacks).toBe(0);
    expect(model.calls).toHaveLength(1);
    expect(
      result.trace.some((event) => event.type === "escalate" && event.reason === "guardrail"),
    ).toBe(true);
  });

  test("provider-like codes thrown by tools remain tool errors", async () => {
    const model = fakeModel([
      { json: { kind: "tool", tool: "ping", brief: "ping it" } },
      { json: { host: "localhost" } },
      { json: { kind: "tool", tool: "ping", brief: "try another host" } },
      { json: { host: "example.com" } },
    ]);
    const failing = {
      ...ping,
      execute: () => {
        throw Object.assign(new Error("Unavailable"), { code: "MODEL_UNAVAILABLE" });
      },
    };
    const result = await createAgent({
      model,
      tools: { ping: failing },
      fallback: async ({ reason }) => {
        expect(reason).toBe("tool-error");
        return { text: "Tool failed" };
      },
    }).run("Ping localhost");
    expect(result.text).toBe("Tool failed");
  });

  test("a throwing model escalates with the message instead of crashing the turn", async () => {
    // Script ends after the plan, so the worker's generate throws: the same
    // shape as a guardrail violation or a dead session after context overflow.
    const model = fakeModel([{ json: { kind: "tool", tool: "ping", brief: "ping it" } }]);
    let received: { reason: string; error?: string } | undefined;
    const agent = createAgent({
      model,
      tools: { ping },
      fallback: async (request) => {
        received = request;
        return { text: "cloud took over" };
      },
    });

    const result = await agent.run("ping");

    expect(result.handledBy).toBe("cloud");
    expect(result.text).toBe("cloud took over");
    expect(received?.reason).toBe("model-error");
    expect(received?.error).toContain("script exhausted");
    expect(result.trace.some((e) => e.type === "escalate" && e.reason === "model-error")).toBe(
      true,
    );
  });

  test("an abort is not swallowed", async () => {
    const controller = new AbortController();
    const model = fakeModel([]);
    model.doGenerate = async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    };
    const agent = createAgent({ model, fallback: async () => ({ text: "no" }) });
    controller.abort();
    await expect(agent.run("x", { signal: controller.signal })).rejects.toThrow("aborted");
  });
});
