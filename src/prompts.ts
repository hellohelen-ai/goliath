import type { StepRecord, ToolMap } from "./types.js";

const DEFAULT_INSTRUCTIONS = "You are a careful assistant that lives on this phone.";

/** One line per tool. The conductor reads these on every step, so they stay short. */
const toolMenu = (tools: ToolMap): string =>
  Object.values(tools)
    .map((tool) => `- ${tool.name}: ${tool.description}${tool.writes ? " (changes things)" : ""}`)
    .join("\n");

/** What happened so far, as the conductor sees it. */
const stepLog = (steps: StepRecord[]): string =>
  steps
    .map((step, i) => {
      if (step.kind === "tool") {
        const outcome = step.result ?? (step.skipped ? "skipped by the user" : "no result");
        return `${i + 1}. ${step.tool}(${compactJson(step.input)}) → ${outcome}`;
      }
      return `${i + 1}. answered: ${step.text ?? ""}`;
    })
    .join("\n");

const compactJson = (value: unknown): string => {
  if (value === undefined) return "";
  const text = JSON.stringify(value);
  return text.length > 120 ? `${text.slice(0, 119)}…` : text;
};

const conductorSystem = (instructions: string, tools: ToolMap, maxSteps: number): string =>
  [
    instructions,
    "You plan one step at a time. Reply with JSON only.",
    `Pick "tool" with the tool name when you need information or must change something. Pick "answer" when you can reply now. Pick "escalate" only when the ask is beyond these tools. You may take at most ${maxSteps} steps.`,
    "Tools:",
    toolMenu(tools),
  ].join("\n");

const conductorUser = (input: {
  ask: string;
  summary: string;
  steps: StepRecord[];
  maxSteps?: number;
}): string =>
  [
    input.summary ? `Earlier (reference only; act on the ask below): ${input.summary}` : "",
    input.steps.length ? `So far:\n${stepLog(input.steps)}` : "",
    `Ask: ${input.ask}`,
    input.maxSteps !== undefined ? stepsLeft(input.steps.length, input.maxSteps) : "",
    "Next step?",
  ]
    .filter(Boolean)
    .join("\n\n");

/** Hermes injects a wrap-up notice at 80% of the budget; the conductor gets the same hint. */
const stepsLeft = (used: number, max: number): string => {
  const left = max - used;
  if (left <= 0) return "No steps left: answer now.";
  if (used >= Math.ceil(max * 0.8)) return `Step ${used + 1} of ${max}: finish now.`;
  return `Step ${used + 1} of ${max}.`;
};

const workerSystem = (instructions: string, brief: string): string =>
  [
    instructions,
    `Do exactly this: ${brief}`,
    "Fill in the arguments from the ask. Never use placeholders or guess a value you were not given; leave it out instead.",
  ].join("\n");

const answerSystem = (instructions: string): string =>
  `${instructions}\nAnswer in two or three short sentences, using only what is below. Do not mention tools.`;

const answerUser = (input: { ask: string; summary: string; steps: StepRecord[] }): string =>
  [
    input.summary ? `Earlier: ${input.summary}` : "",
    input.steps.length ? `What you found:\n${stepLog(input.steps)}` : "",
    `Ask: ${input.ask}`,
  ]
    .filter(Boolean)
    .join("\n\n");

const scribeSystem = [
  "You keep a brief for an assistant. Update it with the new exchange: keep what still holds, add what is new, drop what is stale.",
  "Use exactly these lines: Goal:, Done:, Decisions:, Pending:, Next:. Leave a line empty if nothing fits.",
  "Done is only what actually happened; never list finished work as pending. Pending is what the user asked for and has not received.",
  "Keep exact names, dates, numbers, and ids. At most 60 words. Drop pleasantries.",
].join(" ");

const scribeUser = (input: { summary: string; ask: string; answer: string }): string =>
  [
    input.summary
      ? `Brief so far (prune what is stale or superseded):\n${input.summary}`
      : "Brief so far: (empty)",
    `New exchange:\nUser: ${input.ask}\nAssistant: ${input.answer}`,
    "New brief:",
  ].join("\n\n");

export {
  DEFAULT_INSTRUCTIONS,
  answerSystem,
  answerUser,
  conductorSystem,
  conductorUser,
  scribeSystem,
  scribeUser,
  stepLog,
  stepsLeft,
  toolMenu,
  workerSystem,
};
