/**
 * `bun run evals` — score the fixtures and print the phone-vs-cloud split.
 *
 * With no model on this machine it runs a scripted perfect model, which proves
 * the runner and shows the report shape. On a device, pass a real model to
 * `runEvals` from your app instead.
 */
import { fakeModel, type ScriptedReply } from "../src/testing/index.js";
import { fixtures, type Fixture } from "./fixtures.js";
import { formatReport, runEvals } from "./run-evals.js";

const perfect = (fixture: Fixture): ScriptedReply[] => {
  if (fixture.handledBy === "cloud") {
    return [{ json: { kind: "escalate", brief: "too big for the phone" } }];
  }
  const replies: ScriptedReply[] = [];
  for (const tool of fixture.tools) {
    replies.push({ json: { kind: "tool", tool, brief: `use ${tool}` } });
    if (tool === "createTask") replies.push({ json: { title: fixture.ask } });
  }
  replies.push({ json: { kind: "answer", brief: "reply" } });
  replies.push({ text: `Done: ${fixture.ask}. Milk is still on the list.` });
  return replies;
};

console.log("Scripted smoke test — these results do not measure real model quality.");
const report = await runEvals({
  fixtures,
  model: (fixture) => fakeModel(perfect(fixture)),
  metadata: { model: "scripted", dataset: "goliath-default" },
});
console.log(formatReport(report));
