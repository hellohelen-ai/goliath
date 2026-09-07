import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createAgent, defineTool, inMemory, keyValueMemory } from "../src/index.js";
import { fakeModel } from "../src/testing/index.js";

describe("conversations", () => {
  test("structured output defaults and per-run overrides work across isolated conversations", async () => {
    const model = fakeModel([
      { json: { reply: "Remembered Cedar." } },
      { json: { count: 2 } },
      { json: { reply: "Cedar." } },
    ]);
    const agent = createAgent({ model, outputSchema: z.object({ reply: z.string() }) });
    const first = await agent.run("Remember Cedar", { conversationId: "a" });
    const second = await agent.run("Count tasks", {
      conversationId: "b",
      outputSchema: z.object({ count: z.number() }),
    });
    const third = await agent.run("What did I say?", { conversationId: "a" });
    const reply: string | undefined = first.output?.reply;
    const count: number | undefined = second.output?.count;
    expect(reply).toBe("Remembered Cedar.");
    expect(count).toBe(2);
    expect(third.output).toEqual({ reply: "Cedar." });
    expect(JSON.stringify(model.calls[1]!.prompt)).not.toContain("Cedar");
    expect(JSON.stringify(model.calls[2]!.prompt)).toContain("Remember Cedar");
    expect(model.remaining()).toBe(0);
  });

  test("one agent isolates named and default memory and resumes the selected conversation", async () => {
    const model = fakeModel([
      { text: "Noted Cedar." },
      { text: "Birch." },
      { text: "Cedar." },
      { text: "Default chat." },
    ]);
    const ids: Array<string | undefined> = [];
    const agent = createAgent({
      model,
      extensions: [
        {
          name: "observe",
          beforeRun: ({ conversationId }) => {
            ids.push(conversationId);
          },
        },
      ],
    });
    await agent.run("My codename is Cedar.", { conversationId: "private-thread-a" });
    await agent.run("Remember Birch", { conversationId: "default" });
    await agent.run("What is my codename?", { conversationId: "private-thread-a" });
    await agent.run("Hello");
    expect(JSON.stringify(model.calls[1]!.prompt)).not.toContain("Cedar");
    expect(JSON.stringify(model.calls[2]!.prompt)).toContain("My codename is Cedar.");
    expect(JSON.stringify(model.calls[3]!.prompt)).not.toContain("Birch");
    expect(JSON.stringify(model.calls[3]!.prompt)).not.toContain("Cedar");
    expect(JSON.stringify(model.calls.map(({ prompt }) => prompt))).not.toContain(
      "private-thread-a",
    );
    expect(ids).toEqual(["private-thread-a", "default", "private-thread-a", undefined]);
    expect(model.remaining()).toBe(0);
  });

  test("serializes each conversation while other conversations can make progress", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const started: string[] = [];
    const model = fakeModel([{ text: "B" }, { text: "A1" }, { text: "A2" }]);
    const agent = createAgent({
      model,
      extensions: [
        {
          name: "gate",
          beforeRun: async ({ ask }) => {
            started.push(ask);
            if (ask === "A1") {
              entered.resolve();
              await release.promise;
            }
          },
        },
      ],
    });
    const first = agent.run("A1", { conversationId: "a" });
    await entered.promise;
    const next = agent.run("A2", { conversationId: "a" });
    expect((await agent.run("B", { conversationId: "b" })).text).toBe("B");
    expect(started).toEqual(["A1", "B"]);
    release.resolve();
    expect((await first).text).toBe("A1");
    expect((await next).text).toBe("A2");
    expect(JSON.stringify(model.calls[2]!.prompt)).toContain("A1");
    expect(started).toEqual(["A1", "B", "A2"]);
  });

  test("a failed or aborted queued run does not poison subsequent turns", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const model = fakeModel([{ text: "Recovered." }]);
    const agent = createAgent({
      model,
      extensions: [
        {
          name: "gate",
          beforeRun: async ({ ask }) => {
            if (ask === "fail") {
              entered.resolve();
              await release.promise;
              throw new Error("Failed before generation");
            }
          },
        },
      ],
    });
    const failed = agent.run("fail", { conversationId: "a" }).catch((error: unknown) => error);
    await entered.promise;
    const controller = new AbortController();
    const aborted = agent
      .run("abort", { conversationId: "a", signal: controller.signal })
      .catch((error: unknown) => error);
    const next = agent.run("recover", { conversationId: "a" });
    controller.abort();
    release.resolve();
    expect(await failed).toBeInstanceOf(Error);
    expect(await aborted).toMatchObject({ name: "AbortError" });
    expect((await next).text).toBe("Recovered.");
    expect(model.calls).toHaveLength(1);
  });

  test("keeps fallback error counts and cloud-only routing local to a conversation", async () => {
    const model = fakeModel([]);
    const agent = createAgent({ model, fallback: async () => ({ text: "Cloud." }) });
    for (let i = 0; i < 3; i++) await agent.run("Hello", { conversationId: "broken" });
    expect(agent.isSessionFallback("broken")).toBe(true);
    expect(agent.isSessionFallback("other")).toBe(false);
    expect(agent.sessionFallback).toBe(false);
    const calls = model.calls.length;
    await agent.run("Hello", { conversationId: "broken" });
    expect(model.calls.length).toBe(calls);
    await agent.run("Hello", { conversationId: "other" });
    expect(model.calls.length).toBeGreaterThan(calls);
    expect(agent.isSessionFallback("other")).toBe(false);
  });

  test("calls the memory factory once per conversation and can reopen persisted history", async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const ids: Array<string | undefined> = [];
    const memory = (id: string | undefined) => {
      ids.push(id);
      return keyValueMemory(storage, JSON.stringify(id ?? null));
    };
    const agent = createAgent({
      model: fakeModel([
        { text: "Noted Cedar." },
        { text: "Cedar." },
        { text: "Birch." },
        { text: "Oak." },
      ]),
      memory,
    });
    await agent.run("Remember Cedar", { conversationId: "a" });
    await agent.run("What was it?", { conversationId: "a" });
    await agent.run("Remember Birch", { conversationId: "b" });
    await agent.run("Remember Oak");
    expect(ids).toEqual(["a", "b", undefined]);
    const model = fakeModel([{ text: "Cedar." }]);
    await createAgent({ model, memory }).run("What was it?", { conversationId: "a" });
    expect(JSON.stringify(model.calls[0]!.prompt)).toContain("Cedar");
    expect(JSON.stringify(model.calls[0]!.prompt)).not.toContain("Birch");
    expect(JSON.stringify(model.calls[0]!.prompt)).not.toContain("Oak");
  });

  test("preserves legacy Memory use and rejects sharing it across named conversations", async () => {
    const memory = inMemory();
    const agent = createAgent({ model: fakeModel([{ text: "Hello." }]), memory });
    await expect(agent.run("Hello", { conversationId: "a" })).rejects.toThrow("memory factory");
    expect((await agent.run("Hello")).text).toBe("Hello.");
    expect((await memory.load()).recent).toHaveLength(1);
  });

  test("rejects empty IDs before running the model or creating memory", async () => {
    const model = fakeModel([]);
    let memoryCalls = 0;
    const agent = createAgent({
      model,
      memory: () => {
        memoryCalls++;
        return inMemory();
      },
    });
    await expect(agent.run("Hello", { conversationId: "" })).rejects.toThrow("nonempty string");
    await expect(agent.run("Hello", { conversationId: "  " })).rejects.toThrow("nonempty string");
    expect(model.calls).toHaveLength(0);
    expect(memoryCalls).toBe(0);
  });

  test("per-run approvals stay isolated and tool contexts receive the conversation ID", async () => {
    const writes: Array<string | undefined> = [];
    const write = defineTool({
      name: "write",
      description: "Write a value.",
      parameters: z.object({}),
      writes: true,
      execute: (_, context) => {
        writes.push(context.conversationId);
        return "Saved.";
      },
    });
    const planWrite = { json: { kind: "tool", tool: "write", brief: "Save" } };
    const answer = { json: { kind: "answer", brief: "Reply" } };
    const model = fakeModel([
      planWrite,
      planWrite,
      answer,
      { text: "Declined." },
      answer,
      { text: "Saved A." },
      planWrite,
      answer,
      { text: "Saved C." },
    ]);
    let defaultApprovals = 0;
    const agent = createAgent({
      model,
      tools: { write },
      confirm: async () => {
        defaultApprovals++;
        return true;
      },
    });
    const pending = Promise.withResolvers<boolean>();
    const entered = Promise.withResolvers<void>();
    const first = agent.run("Write A", {
      conversationId: "a",
      confirm: () => {
        entered.resolve();
        return pending.promise;
      },
    });
    await entered.promise;
    await agent.run("Write B", { conversationId: "b", confirm: async () => false });
    expect(writes).toEqual([]);
    pending.resolve(true);
    await first;
    await agent.run("Write C", { conversationId: "c" });
    expect(writes).toEqual(["a", "c"]);
    expect(defaultApprovals).toBe(1);
    expect(model.remaining()).toBe(0);
  });
});
