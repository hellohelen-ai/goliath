import { defineTool } from "@hellohelen-ai/goliath";
import { z } from "zod";
import { mockTaskStore } from "./mock-store";

export const completeTask = defineTool({
  name: "completeTask",
  description: "Mark a task done using its ID from listTasks.",
  parameters: z.object({ id: z.number().int().positive() }),
  requires: ["listTasks"],
  resolveInput: ({ id }, context) => {
    const listed = context.steps?.findLast((step) => step.tool === "listTasks")?.output;
    const tasks = z.array(z.object({ id: z.number() })).parse(listed);
    if (!tasks.some((task) => task.id === id))
      throw new Error("Choose a task ID returned by listTasks in this turn.");
    return { id };
  },
  writes: true,
  execute: ({ id }) => mockTaskStore.complete(id),
});
