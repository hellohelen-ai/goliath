import type { Task } from "./types";

// Shared by the demo tools across conversations for the current app session.
let tasks: Task[] = [
  { id: 1, title: "Call the dentist", done: false },
  { id: 2, title: "Renew the passport", done: false },
];
let nextId = 3;

export const mockTaskStore = {
  list: () => tasks.filter((task) => !task.done),
  create: (title: string) => {
    const task: Task = { id: nextId++, title, done: false };
    tasks = [...tasks, task];
    return task;
  },
  complete: (id: number) => {
    tasks = tasks.map((task) => (task.id === id ? { ...task, done: true } : task));
    return tasks.find((task) => task.id === id) ?? { error: `no task ${id}` };
  },
};
