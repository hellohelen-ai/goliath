import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createAgent, defineTool, type GoliathExtension } from "../src/index.js";
import { fakeModel } from "../src/testing/index.js";

const pickWrite = { json: { kind: "tool", tool: "write", brief: "write a value" } };
const pickAnswer = { json: { kind: "answer", brief: "reply" } };
const answer = { text: "Written." };

describe("tool argument validation", () => {
  test.each(["no extension", "observer", "rewrite"] as const)(
    "schema transformations run once per input with %s",
    async (mode) => {
      let transformations = 0;
      const confirmed: unknown[] = [];
      const executed: unknown[] = [];
      const observed: unknown[] = [];
      const write = defineTool({
        name: "write",
        description: "Write a value.",
        writes: true,
        parameters: z.object({
          value: z.number().overwrite((value) => {
            transformations++;
            return value + 1;
          }),
        }),
        execute: (input) => {
          executed.push(input);
          return "done";
        },
      });
      const extension: GoliathExtension = {
        name: "inspect-input",
        beforeTool: ({ input }) => {
          observed.push(input);
          if (mode === "rewrite") return { input: { value: 10 } };
        },
      };
      const model = fakeModel([pickWrite, { json: { value: 1 } }, pickAnswer, answer]);
      const result = await createAgent({
        model,
        tools: { write },
        extensions: mode === "no extension" ? [] : [extension],
        confirm: async ({ input }) => {
          confirmed.push(input);
          return true;
        },
      }).run("write 1");

      const expected = { value: mode === "rewrite" ? 11 : 2 };
      expect(confirmed).toEqual([expected]);
      expect(executed).toEqual([expected]);
      expect(result.steps[0]?.input).toEqual(expected);
      expect(observed).toEqual(mode === "no extension" ? [] : [{ value: 2 }]);
      expect(transformations).toBe(mode === "rewrite" ? 2 : 1);
      expect(model.remaining()).toBe(0);
    },
  );

  test("no-argument calls still validate locally once without a worker model call", async () => {
    let validations = 0;
    const write = defineTool({
      name: "write",
      description: "Write a value.",
      parameters: z.object({}).overwrite((value) => {
        validations++;
        return value;
      }),
      execute: () => "done",
    });
    const model = fakeModel([pickWrite, pickAnswer, answer]);
    const result = await createAgent({ model, tools: { write } }).run("write");

    expect(validations).toBe(1);
    expect(result.steps[0]?.input).toEqual({});
    expect(model.calls).toHaveLength(3);
    expect(model.remaining()).toBe(0);
  });

  test.each(["generated", "no arguments"] as const)(
    "invalid %s input never reaches confirmation or execution",
    async (mode) => {
      let confirms = 0;
      let executions = 0;
      const reasons: string[] = [];
      const write = defineTool({
        name: "write",
        description: "Write a value.",
        writes: true,
        parameters:
          mode === "generated" ? z.object({ value: z.number() }) : z.object({}).refine(() => false),
        execute: () => {
          executions++;
          return "done";
        },
      });
      const model = fakeModel(
        mode === "generated" ? [pickWrite, { json: { value: "invalid" } }] : [pickWrite],
      );
      await createAgent({
        model,
        tools: { write },
        confirm: async () => {
          confirms++;
          return true;
        },
        fallback: async ({ reason }) => {
          reasons.push(reason);
          return { text: "cloud" };
        },
      }).run("write");

      expect(confirms).toBe(0);
      expect(executions).toBe(0);
      expect(reasons).toEqual(["tool-args-invalid"]);
      expect(model.remaining()).toBe(0);
    },
  );
});
