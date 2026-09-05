import { completeTask, createTask, listTasks } from "../tasks";

// Keep suggested requests next to the mock tools registered with the agent.
const catalog = [
  {
    tool: listTasks,
    title: "See what’s on my list",
    ask: "List my open tasks.",
    icon: "list-outline",
  },
  {
    tool: createTask,
    title: "Add something to do",
    ask: "Add a task to water the plants.",
    icon: "add-outline",
  },
  {
    tool: completeTask,
    title: "Check off a task",
    ask: "List my tasks, then mark Call the dentist done.",
    icon: "checkmark-outline",
  },
] as const;

export const mockTools = Object.fromEntries(catalog.map(({ tool }) => [tool.name, tool]));
export const mockSuggestions = catalog.map(({ tool, ...suggestion }) => ({
  id: tool.name,
  ...suggestion,
}));
export type ToolSuggestion = (typeof mockSuggestions)[number];
