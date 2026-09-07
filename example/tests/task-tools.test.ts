import { expect, test } from "bun:test";
import { createAgent } from "@hellohelen-ai/goliath";
import { fakeModel } from "@hellohelen-ai/goliath/testing";
import { completeTask, listTasks } from "../src/agents/goliath/tools/tasks";
import { mockTaskStore } from "../src/agents/goliath/tools/tasks/mock-store";

const lookup = { json: { kind: "tool", tool: "listTasks", brief: "Find the task." } };
const complete = { json: { kind: "tool", tool: "completeTask", brief: "Complete the task." } };
const answer = { json: { kind: "answer", brief: "Report the result." } };

test("completion selects a listed ID even when two tasks share a title", async () => {
  const first = mockTaskStore.create("Duplicate title"),
    second = mockTaskStore.create("Duplicate title");
  const model = fakeModel([
    lookup,
    complete,
    { json: { id: second.id } },
    answer,
    { text: "Done." },
  ]);
  const approvals: unknown[] = [];
  const result = await createAgent({
    model,
    tools: { listTasks, completeTask },
    confirm: async ({ input }) => {
      approvals.push(input);
      return true;
    },
  }).run(`Complete task ${second.id}.`);
  expect(approvals).toEqual([{ id: second.id }]);
  expect(result.steps[1]).toMatchObject({
    tool: "completeTask",
    input: { id: second.id },
    output: { id: second.id, done: true },
  });
  expect(mockTaskStore.list().some((task) => task.id === first.id)).toBe(true);
  expect(mockTaskStore.list().some((task) => task.id === second.id)).toBe(false);
  const prompt = JSON.stringify(model.calls[2]!.prompt);
  expect(prompt).toContain(
    JSON.stringify({ id: second.id, title: second.title }).replaceAll('"', '\\"'),
  );
  expect(model.calls).toHaveLength(5);
});

for (const selection of ["invented", "unlisted"] as const) {
  test(`an ${selection} ID is rejected before approval or execution`, async () => {
    const visible = mockTaskStore.create("Visible task");
    const hidden = mockTaskStore.create("Not returned by this lookup");
    const id = selection === "invented" ? 999999 : hidden.id;
    const model = fakeModel([
      lookup,
      complete,
      { json: { id } },
      { text: "I couldn’t select that task." },
    ]);
    let approvals = 0,
      executions = 0;
    const result = await createAgent({
      model,
      tools: {
        listTasks: { ...listTasks, execute: () => [visible] },
        completeTask: {
          ...completeTask,
          execute: (input) => {
            executions++;
            return completeTask.execute(input, {});
          },
        },
      },
      confirm: async () => {
        approvals++;
        return true;
      },
    }).run(`Complete task ${id}.`);
    expect(result.trace).toContainEqual({ type: "escalate", reason: "tool-args-invalid" });
    expect(approvals).toBe(0);
    expect(executions).toBe(0);
    expect(mockTaskStore.list().some((task) => task.id === hidden.id)).toBe(true);
  });
}
