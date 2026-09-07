import { describe, expect, test } from "bun:test";
import { createAgent, defineTool } from "@hellohelen-ai/goliath";
import { fakeModel } from "@hellohelen-ai/goliath/testing";
import { z } from "zod";
import {
  createAgentRuntime,
  type AgentContext,
  type ApprovalRequest,
} from "../src/agents/goliath/runtime";
import { createAppStore } from "../src/stores/app-store";

const planAnswer = { json: { kind: "answer", brief: "Reply" } };

function writeRuntime() {
  const writes: string[] = [];
  const save = defineTool({
    name: "save",
    description: "Save a task.",
    parameters: z.object({ title: z.string() }),
    writes: true,
    execute: ({ title }) => {
      writes.push(title);
      return { title };
    },
  });
  const runtime = createAgentRuntime((confirm) =>
    createAgent<AgentContext>({
      confirm,
      tools: { save },
      model: fakeModel([
        { json: { kind: "tool", tool: "save", brief: "Save the task" } },
        { json: { title: "Water plants" } },
        planAnswer,
        { text: "Finished." },
      ]),
    }),
  );
  return { runtime, writes };
}

describe("agent runtime", () => {
  test("reuses memory within a conversation and isolates other conversations", async () => {
    const models = [
      fakeModel([{ text: "Remembered Cedar." }, { text: "Cedar." }]),
      fakeModel([{ text: "Hello." }]),
    ];
    let created = 0;
    const runtime = createAgentRuntime((confirm) =>
      createAgent<AgentContext>({ model: models[created++]!, confirm }),
    );
    expect((await runtime.ask("first", "My codename is Cedar.")).text).toBe("Remembered Cedar.");
    expect((await runtime.ask("first", "What is my codename?")).text).toBe("Cedar.");
    expect((await runtime.ask("second", "Hello")).text).toBe("Hello.");
    expect(created).toBe(2);
    expect(JSON.stringify(models[0]!.calls[1]!.prompt)).toContain("My codename is Cedar.");
    expect(JSON.stringify(models[1]!.calls[0]!.prompt)).not.toContain("Cedar");
    runtime.dispose();
  });

  test("isolates approvals across concurrent conversations and rejects duplicate sends", async () => {
    const { runtime, writes } = writeRuntime();
    const firstApproval = Promise.withResolvers<ApprovalRequest>();
    const secondApproval = Promise.withResolvers<ApprovalRequest>();
    const first = runtime.ask("first", "Save a task", { onApproval: firstApproval.resolve });
    const second = runtime.ask("second", "Save a task", { onApproval: secondApproval.resolve });
    await Promise.all([firstApproval.promise, secondApproval.promise]);
    expect(writes).toEqual([]);
    await expect(runtime.ask("first", "Duplicate")).rejects.toThrow("already running");
    expect(runtime.approve("first", true)).toBe(true);
    expect(runtime.approve("first", true)).toBe(false);
    expect(runtime.approve("second", false)).toBe(true);
    await Promise.all([first, second]);
    expect(writes).toEqual(["Water plants"]);
    runtime.dispose();
  });

  test("cancels a pending approval without writing and releases the conversation", async () => {
    const { runtime, writes } = writeRuntime();
    const approval = Promise.withResolvers<ApprovalRequest>();
    const pending = runtime.ask("first", "Save a task", { onApproval: approval.resolve });
    const settled = pending.catch((error: unknown) => error);
    await approval.promise;
    runtime.cancel("first");
    expect(runtime.approve("first", true)).toBe(false);
    expect(await settled).toMatchObject({ name: "AbortError" });
    expect(writes).toEqual([]);
    expect((await runtime.ask("first", "Hello")).text).toBe("Finished.");
    runtime.dispose();
  });

  test("disposes pending work and can start fresh after a React effect remount", async () => {
    const { runtime, writes } = writeRuntime();
    const approval = Promise.withResolvers<ApprovalRequest>();
    const pending = runtime.ask("first", "Save a task", { onApproval: approval.resolve });
    const settled = pending.catch((error: unknown) => error);
    await approval.promise;
    runtime.dispose();
    expect(await settled).toMatchObject({ name: "AbortError" });
    expect(writes).toEqual([]);
    await runtime.ask("first", "Save again", {
      onApproval: () => {
        runtime.approve("first", true);
      },
    });
    expect(writes).toEqual(["Water plants"]);
    runtime.dispose();
  });

  test("conversation actions receive approvals and background results from the runtime", async () => {
    const store = createAppStore();
    const conversations = store.getState();
    const { runtime } = writeRuntime();
    const address = { conversationId: "first", messageId: "reply" };
    const approval = Promise.withResolvers<ApprovalRequest>();
    conversations.startTurn(address, "Save a task");
    const pending = runtime.ask("first", "Save a task", {
      onApproval: (request) => {
        conversations.requestApproval(address, request);
        approval.resolve(request);
      },
    });
    await approval.promise;
    const second = conversations.newConversation();
    conversations.openConversation(second);
    conversations.setDraft(second, "Keep my draft");
    expect(runtime.approve("first", true)).toBe(true);
    conversations.recordApproval(address, true);
    conversations.completeTurn(address, await pending);
    const message = store
      .getState()
      .conversations.find(({ id }) => id === "first")!
      .messages.at(-1)!;
    expect(message).toMatchObject({
      status: "completed",
      text: "Finished.",
      confirmation: { tool: "save", decision: true },
    });
    expect(store.getState().selectedId).toBe(second);
    expect(store.getState().conversations[0].draft).toBe("Keep my draft");
    const retry = { ...address, messageId: "retry" };
    expect(conversations.startTurn(retry, "Try again")).toBe(true);
    conversations.requestApproval(retry, { tool: "save", input: { title: "New task" } });
    conversations.failTurn(retry, new Error("Model unavailable"));
    expect(
      store
        .getState()
        .conversations.find(({ id }) => id === "first")!
        .messages.at(-1),
    ).toMatchObject({
      status: "error",
      text: "Model unavailable",
      confirmation: { decision: false },
    });
    runtime.dispose();
  });
});
