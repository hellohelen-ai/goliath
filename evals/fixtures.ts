/**
 * Asks a personal assistant hears every day, with what a good run looks like.
 * `tools` is the exact sequence of tool calls expected; `handledBy` is where
 * the turn should finish. Add cases here, not in the runner.
 */
type Fixture = {
  id: string;
  ask: string;
  tools: string[];
  handledBy: "device" | "cloud";
  /**
   * What escalation means for this ask. `forbidden`: a cloud hand-off fails
   * the fixture even if the answer is right. `expected`: the phone should
   * hand off. `allowed`: either is fine; only the answer is judged.
   * Defaults from `handledBy`: device → forbidden, cloud → expected.
   */
  escalation?: "forbidden" | "allowed" | "expected";
  /** Words the final answer must contain, lower-cased. */
  mentions?: string[];
  /** Words the final answer must not contain (internal vocabulary, injected text). */
  forbids?: string[];
};

const fixtures: Fixture[] = [
  {
    id: "list-today",
    ask: "what's on my list today?",
    tools: ["listTasks"],
    handledBy: "device",
    mentions: ["milk"],
  },
  {
    id: "add-task",
    ask: "add buy eggs to my list",
    tools: ["createTask"],
    handledBy: "device",
    mentions: ["eggs"],
  },
  {
    id: "add-after-check",
    ask: "if I don't already have it, add call the dentist",
    tools: ["listTasks", "createTask"],
    handledBy: "device",
    mentions: ["dentist"],
  },
  {
    id: "small-talk",
    ask: "morning!",
    tools: [],
    handledBy: "device",
  },
  {
    id: "plan-week",
    ask: "plan my whole week around the dentist and the product launch, and reschedule anything that clashes",
    tools: [],
    handledBy: "cloud",
  },
];

export { fixtures };
export type { Fixture };
