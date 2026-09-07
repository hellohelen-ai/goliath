import { completeTask, createTask, listTasks } from "./tasks";

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
const taskSuggestions = catalog.map(({ tool, ...suggestion }) => ({
  id: tool.name,
  ...suggestion,
}));
export const mockSuggestions = [
  ...taskSuggestions,
  {
    id: "grep",
    title: "Find the greenhouse code",
    ask: "Find the greenhouse access code in /docs.",
    icon: "search-outline" as const,
  },
  {
    id: "readFile",
    title: "Read the file guide",
    ask: "Read /docs/guide.md.",
    icon: "document-text-outline" as const,
  },
  {
    id: "writeFile",
    title: "Save a note",
    ask: "Create /notes/garden.md with the text: Water the basil on Tuesday.",
    icon: "create-outline" as const,
  },
];
export type ToolSuggestion = (typeof mockSuggestions)[number];
