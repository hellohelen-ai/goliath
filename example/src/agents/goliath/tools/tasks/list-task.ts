import { defineTool } from "@hellohelen-ai/goliath";
import { z } from "zod";
import { mockTaskStore } from "./mock-store";

export const listTasks = defineTool({
  name: "listTasks",
  description: "List open tasks with their IDs and titles.",
  parameters: z.object({}),
  execute: () => mockTaskStore.list(),
  toModelOutput: (tasks) =>
    tasks.length
      ? tasks.map(({ id, title }) => JSON.stringify({ id, title })).join("\n")
      : "No open tasks.",
});
