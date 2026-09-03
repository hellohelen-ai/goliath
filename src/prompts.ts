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
        const outcome = step.skipped ? "skipped by the user" : (step.result ?? "no result");
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

const conductorUser = (input: { ask: string; summary: string; steps: StepRecord[] }): string =>
  [
    input.summary ? `Earlier: ${input.summary}` : "",
    input.steps.length ? `So far:\n${stepLog(input.steps)}` : "",
    `Ask: ${input.ask}`,
    "Next step?",
  ]
    .filter(Boolean)
    .join("\n\n");

const workerSystem = (instructions: string, brief: string): string =>
  `${instructions}\nDo exactly this: ${brief}\nCall the tool with the right arguments.`;

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
  "You keep a brief for an assistant. Rewrite it to include the new exchange.",
  "Use exactly these lines: Goal:, Done:, Decisions:, Next:. Leave a line empty if nothing fits.",
  "At most 60 words. Keep names, dates, numbers, and choices. Drop pleasantries.",
].join(" ");

const scribeUser = (input: { summary: string; ask: string; answer: string }): string =>
  [
    input.summary ? `Brief so far: ${input.summary}` : "Brief so far: (empty)",
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
  toolMenu,
  workerSystem,
};
