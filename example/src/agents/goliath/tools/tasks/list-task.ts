import { defineTool } from "@hellohelen-ai/goliath";
import { z } from "zod";
import { mockTaskStore } from "./mock-store";

export const listTasks = defineTool({
  name: "listTasks",
  description: "The user's open tasks.",
  parameters: z.object({}),
  execute: () => mockTaskStore.list(),
});
