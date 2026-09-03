import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult } from "@ai-sdk/provider";

/** One scripted reply. `json` is for structured output, `toolCall` for a worker step. */
type ScriptedReply =
  { text: string } | { json: unknown } | { toolCall: { name: string; input: unknown } };

type FakeModel = MockLanguageModelV4 & {
  /** Every prompt the harness sent, in order, for assertions. */
  calls: LanguageModelV4CallOptions[];
  /** Replies not yet consumed. Empty at the end of a well-scripted test. */
  remaining: () => number;
};

const usage = (input: number, output: number): LanguageModelV4GenerateResult["usage"] => ({
  inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: output, text: output, reasoning: 0 },
});

const promptChars = (options: LanguageModelV4CallOptions): number =>
  JSON.stringify(options.prompt).length;

const toResult = (
  reply: ScriptedReply,
  options: LanguageModelV4CallOptions,
): LanguageModelV4GenerateResult => {
  const inputTokens = Math.ceil(promptChars(options) / 4);
  if ("toolCall" in reply) {
    const input = JSON.stringify(reply.toolCall.input ?? {});
    return {
      content: [
        {
          type: "tool-call",
          toolCallId: `call_${Math.random().toString(36).slice(2, 8)}`,
          toolName: reply.toolCall.name,
          input,
        },
      ],
      finishReason: { unified: "tool-calls", raw: "tool-calls" },
      usage: usage(inputTokens, Math.ceil(input.length / 4)),
      warnings: [],
    };
  }
  const text = "json" in reply ? JSON.stringify(reply.json) : reply.text;
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: usage(inputTokens, Math.ceil(text.length / 4)),
    warnings: [],
  };
};

/**
 * A language model that reads from a script. Each `doGenerate` consumes the
 * next reply; running out throws, so a test cannot silently pass on air.
 */
const fakeModel = (script: ScriptedReply[]): FakeModel => {
  const queue = [...script];
  const calls: LanguageModelV4CallOptions[] = [];
  const model = new MockLanguageModelV4({
    provider: "goliath.fake",
    modelId: "scripted",
    doGenerate: async (options) => {
      calls.push(options);
      const reply = queue.shift();
      if (!reply) {
        throw new Error(`fakeModel: script exhausted after ${calls.length} call(s)`);
      }
      return toResult(reply, options);
    },
  }) as FakeModel;
  model.calls = calls;
  model.remaining = () => queue.length;
  return model;
};

export { fakeModel };
export type { FakeModel, ScriptedReply };
