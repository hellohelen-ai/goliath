import type { z } from "zod";
import type { GoliathTool, ToolContext } from "../types.js";

type DefineToolArgs<INPUT, OUTPUT> = {
  name: string;
  description: string;
  parameters: z.ZodType<INPUT>;
  writes?: boolean;
  execute: (input: INPUT, context: ToolContext) => Promise<OUTPUT> | OUTPUT;
};

/**
 * Declare a tool. A thin identity function that pins the types.
 *
 * Keep `parameters` flat: primitives and enums, no nested objects, no unions.
 * That is what a 3B model fills in reliably and what Apple's guided
 * generation accepts (docs/research/rn-providers-and-ai-sdk.md § 1.5).
 */
const defineTool = <INPUT, OUTPUT>(
  args: DefineToolArgs<INPUT, OUTPUT>,
): GoliathTool<INPUT, OUTPUT> => args;

export { defineTool };
