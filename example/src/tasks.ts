import { defineTool } from "@hellohelen-ai/goliath";
import { z } from "zod";

type Task = { id: number; title: string; done: boolean };

// Stands in for whatever the real app talks to. The point of the example is the
// loop, not the store.
let tasks: Task[] = [
  { id: 1, title: "Call the dentist", done: false },
  { id: 2, title: "Renew the passport", done: false },
];
let nextId = 3;

const listTasks = defineTool({
  name: "listTasks",
  description: "The user's open tasks.",
  parameters: z.object({}),
  execute: () => tasks.filter((task) => !task.done),
});

const createTask = defineTool({
  name: "createTask",
  description: "Add a task.",
  // Flat parameters: primitives only. That is what a 3B model fills in
  // reliably and what Apple's guided generation accepts.
  parameters: z.object({ title: z.string() }),
  writes: true, // Goliath asks before running it
  execute: ({ title }) => {
    const task: Task = { id: nextId++, title, done: false };
    tasks = [...tasks, task];
    return task;
  },
});

const completeTask = defineTool({
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
    tasks = tasks.map((task) => (task.id === id ? { ...task, done: true } : task));
    return tasks.find((task) => task.id === id) ?? { error: `no task ${id}` };
  },
});

export { listTasks, createTask, completeTask };
export type { Task };
