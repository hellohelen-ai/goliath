import { defineTool } from "@hellohelen-ai/goliath";
import { z } from "zod";
import { mockTaskStore } from "./mock-store";

export const createTask = defineTool({
  name: "createTask",
  description: "Add a task.",
  // Flat parameters: primitives only. That is what a 3B model fills in
  // reliably and what Apple's guided generation accepts.
  parameters: z.object({ title: z.string() }),
  writes: true, // Goliath asks before running it
  execute: ({ title }) => mockTaskStore.create(title),
});
