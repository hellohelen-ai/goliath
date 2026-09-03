import { describe, expect, test } from "bun:test";
import { httpFallback } from "../src/fallback/http-fallback.js";
import { keyValueMemory } from "../src/memory/key-value.js";

describe("keyValueMemory", () => {
  const fakeStore = () => {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
    };
  };

  test("round-trips state as one JSON string", async () => {
    const store = fakeStore();
    const memory = keyValueMemory(store, "k");
    await memory.save({ summary: "brief", recent: [{ ask: "a", answer: "b", at: 1 }] });
    expect(store.data.get("k")).toBe(
      '{"summary":"brief","recent":[{"ask":"a","answer":"b","at":1}]}',
    );
    expect(await memory.load()).toEqual({
      summary: "brief",
      recent: [{ ask: "a", answer: "b", at: 1 }],
    });
  });

  test("missing or corrupt data reads as empty", async () => {
    const store = fakeStore();
    const memory = keyValueMemory(store);
    expect(await memory.load()).toEqual({ summary: "", recent: [] });
    store.data.set("goliath.memory", "{not json");
    expect(await memory.load()).toEqual({ summary: "", recent: [] });
    store.data.set("goliath.memory", JSON.stringify({ summary: 1 }));
    expect(await memory.load()).toEqual({ summary: "", recent: [] });
  });
});

describe("httpFallback", () => {
  test("posts the turn without the signal and reads back text", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fallback = httpFallback({
      url: "https://example.test/turn",
      headers: async () => ({ authorization: "Bearer t" }),
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        seen = { url: String(url), init: init ?? {} };
        return new Response(JSON.stringify({ text: "from the cloud" }), { status: 200 });
      }) as unknown as typeof fetch,
    });

    const controller = new AbortController();
    const result = await fallback({
      ask: "plan my week",
      summary: "s",
      recent: [],
      steps: [],
      reason: "conductor-asked",
      signal: controller.signal,
    });

    expect(result).toEqual({ text: "from the cloud" });
    expect(seen?.url).toBe("https://example.test/turn");
    expect(seen?.init.method).toBe("POST");
    expect((seen?.init.headers as Record<string, string>).authorization).toBe("Bearer t");
    expect(seen?.init.signal).toBe(controller.signal);
    const body = JSON.parse(String(seen?.init.body));
    expect(body).toEqual({
      ask: "plan my week",
      summary: "s",
      recent: [],
      steps: [],
      reason: "conductor-asked",
    });
  });

  test("a non-2xx or a body without text throws", async () => {
    const bad = httpFallback({
      url: "https://example.test/turn",
      fetch: (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch,
    });
    const request = {
      ask: "x",
      summary: "",
      recent: [],
      steps: [],
      reason: "empty-answer" as const,
    };
    await expect(bad(request)).rejects.toThrow("500");

    const noText = httpFallback({
      url: "https://example.test/turn",
      fetch: (async () =>
        new Response(JSON.stringify({ answer: "?" }), { status: 200 })) as unknown as typeof fetch,
    });
    await expect(noText(request)).rejects.toThrow("no `text`");
  });
});
