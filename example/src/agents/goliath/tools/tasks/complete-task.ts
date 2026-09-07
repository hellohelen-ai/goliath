import { defineTool } from "@hellohelen-ai/goliath";
import { z } from "zod";
import { mockTaskStore } from "./mock-store";

export const completeTask = defineTool({
  name: "completeTask",
  description: "Mark a listed task done by its exact title.",
  parameters: z.object({ title: z.string(), id: z.number().optional() }),
  requires: ["listTasks"],
  resolveInput: ({ title }, context) => {
    const listed = context.steps?.findLast((step) => step.tool === "listTasks")?.output;
    const matches = z
      .array(z.object({ id: z.number(), title: z.string() }))
      .parse(listed)
      .filter((task) => task.title === title);
    if (matches.length !== 1) throw new Error("Choose exactly one listed task.");
    return { title, id: matches[0]!.id };
  },
  writes: true,
  execute: ({ id }) => {
    if (id === undefined) throw new Error("A listed task must be selected first.");
    return mockTaskStore.complete(id);
  },
});
