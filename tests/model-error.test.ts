import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createGoliath, defineTool } from "../src/index.js";
import { fakeModel } from "../src/testing/index.js";

const ping = defineTool({
  name: "ping",
  description: "Ping a host.",
  parameters: z.object({ host: z.string() }),
  execute: () => "pong",
});

describe("model errors", () => {
  test("a throwing model escalates with the message instead of crashing the turn", async () => {
    // Script ends after the plan, so the worker's generate throws: the same
    // shape as a guardrail violation or a dead session after context overflow.
    const model = fakeModel([{ json: { kind: "tool", tool: "ping", brief: "ping it" } }]);
    let received: { reason: string; error?: string } | undefined;
    const goliath = createGoliath({
      model,
      tools: { ping },
      fallback: async (request) => {
        received = request;
        return { text: "cloud took over" };
      },
    });

    const result = await goliath.run("ping");

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
    const goliath = createGoliath({ model, fallback: async () => ({ text: "no" }) });
    controller.abort();
    await expect(goliath.run("x", { signal: controller.signal })).rejects.toThrow("aborted");
  });
});
