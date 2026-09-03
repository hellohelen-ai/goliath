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
  description: "Mark a task done by its id.",
  parameters: z.object({ id: z.number() }),
  writes: true,
  execute: ({ id }) => {
    tasks = tasks.map((task) => (task.id === id ? { ...task, done: true } : task));
    return tasks.find((task) => task.id === id) ?? { error: `no task ${id}` };
  },
});

export { listTasks, createTask, completeTask };
export type { Task };
