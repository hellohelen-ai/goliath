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
    replies.push({
      toolCall: { name: tool, input: tool === "createTask" ? { title: fixture.ask } : {} },
    });
  }
  replies.push({ json: { kind: "answer", brief: "reply" } });
  replies.push({ text: `Done: ${fixture.ask}. Milk is still on the list.` });
  return replies;
};

const report = await runEvals({ fixtures, model: (fixture) => fakeModel(perfect(fixture)) });
console.log(formatReport(report));
