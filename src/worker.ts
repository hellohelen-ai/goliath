import { generateText, stepCountIs, type LanguageModel } from "ai";
import { summarizeToolResult } from "./compress/structural.js";
import { answerSystem, answerUser, workerSystem } from "./prompts.js";
import { isDeclined, toAiTool } from "./tools/define-tool.js";
import type { Confirm, GoliathTool, StepRecord } from "./types.js";

type ToolStepOutcome = {
  input: unknown;
  result: string;
  skipped: boolean;
  /** The model answered in prose instead of calling the tool. */
  text?: string;
};

/**
 * A worker gets a fresh context, one tool, and a one-line brief. It calls the
 * tool once and hands back a compressed result. Nothing else it saw survives.
 */
const runToolStep = async (input: {
  model: LanguageModel;
  instructions: string;
  tool: GoliathTool<any, any>;
  brief: string;
  ask: string;
  confirm: Confirm;
  signal?: AbortSignal;
}): Promise<ToolStepOutcome> => {
  const aiTool = toAiTool(input.tool, {
    confirm: input.confirm,
    brief: input.brief,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const result = await generateText({
    model: input.model,
    tools: { [input.tool.name]: aiTool },
    toolChoice: { type: "tool", toolName: input.tool.name },
    stopWhen: stepCountIs(1),
    system: workerSystem(input.instructions, input.brief),
    prompt: input.ask,
    ...(input.signal ? { abortSignal: input.signal } : {}),
  });

  const toolResult = result.toolResults[0];
  if (!toolResult) {
    return { input: undefined, result: "", skipped: false, text: result.text.trim() };
  }
  const output = toolResult.output;
  if (isDeclined(output)) {
    return { input: toolResult.input, result: "skipped by the user", skipped: true };
  }
  return { input: toolResult.input, result: summarizeToolResult(output), skipped: false };
};

/** The closing stone: turn the step log into two or three sentences. */
const runAnswerStep = async (input: {
  model: LanguageModel;
  instructions: string;
  ask: string;
  summary: string;
  steps: StepRecord[];
  signal?: AbortSignal;
}): Promise<string> => {
  const result = await generateText({
    model: input.model,
    system: answerSystem(input.instructions),
    prompt: answerUser({ ask: input.ask, summary: input.summary, steps: input.steps }),
    ...(input.signal ? { abortSignal: input.signal } : {}),
  });
  return result.text.trim();
};

export { runAnswerStep, runToolStep };
export type { ToolStepOutcome };
