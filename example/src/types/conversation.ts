import type { RunResult } from "@hellohelen-ai/goliath";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  status?: "running" | "completed" | "error";
  result?: RunResult;
  confirmation?: { tool: string; input: unknown; decision?: boolean };
};
export type Conversation = {
  id: string;
  createdAt: number;
  messages: ChatMessage[];
  draft: string;
};
