import { tool as aiTool, type Tool } from "ai";
import type { z } from "zod";
import type { Confirm, GoliathTool, ToolContext } from "../types.js";

type DefineToolArgs<INPUT, OUTPUT> = {
  name: string;
  description: string;
  parameters: z.ZodType<INPUT>;
  writes?: boolean;
  execute: (input: INPUT, context: ToolContext) => Promise<OUTPUT> | OUTPUT;
};

/** Declare a tool. A thin identity function that pins the types. */
const defineTool = <INPUT, OUTPUT>(
  args: DefineToolArgs<INPUT, OUTPUT>,
): GoliathTool<INPUT, OUTPUT> => args;

type Declined = { skipped: true; reason: "declined" };

/**
 * Bridge one Goliath tool into an AI SDK tool. Tools that write run the
 * host's confirm first; a decline returns a marker instead of throwing, so
 * the model hears "not done" rather than an error.
 */
const toAiTool = (
  goliathTool: GoliathTool<any, any>,
  options: { confirm: Confirm; brief: string; signal?: AbortSignal },
): Tool =>
  aiTool({
    description: goliathTool.description,
    inputSchema: goliathTool.parameters,
    execute: async (input: unknown): Promise<unknown | Declined> => {
      if (goliathTool.writes) {
        const approved = await options.confirm({
          tool: goliathTool.name,
          input,
          brief: options.brief,
        });
        if (!approved) return { skipped: true, reason: "declined" } satisfies Declined;
      }
      const context: ToolContext = options.signal ? { signal: options.signal } : {};
      return goliathTool.execute(input, context);
    },
  });

const isDeclined = (value: unknown): value is Declined =>
  typeof value === "object" &&
  value !== null &&
  (value as Declined).skipped === true &&
  (value as Declined).reason === "declined";

export { defineTool, isDeclined, toAiTool };
