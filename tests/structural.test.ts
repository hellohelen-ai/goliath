import { describe, expect, test } from "bun:test";
import { summarizeToolResult } from "../src/compress/structural.js";

describe("summarizeToolResult", () => {
  test("arrays of records become numbered key: value lines", () => {
    const text = summarizeToolResult([
      { id: "t1", title: "Buy milk", done: false, nested: { deep: 1 } },
      { id: "t2", title: "Call mom", done: true },
    ]);
    expect(text).toBe(
      "1. id: t1, title: Buy milk, done: false\n2. id: t2, title: Call mom, done: true",
    );
  });

  test("long arrays are cut with a count", () => {
    const text = summarizeToolResult(Array.from({ length: 12 }, (_, i) => `item ${i}`));
    expect(text.split("\n")).toHaveLength(9);
    expect(text).toEndWith("…and 4 more");
  });

  test("records list their fields, one per line", () => {
    const text = summarizeToolResult({ ok: true, count: 3, note: "x".repeat(200) });
    const lines = text.split("\n");
    expect(lines[0]).toBe("ok: true");
    expect(lines[1]).toBe("count: 3");
    expect(lines[2]?.length).toBeLessThanOrEqual("note: ".length + 80);
  });

  test("empty and undefined read as words, not JSON", () => {
    expect(summarizeToolResult([])).toBe("none");
    expect(summarizeToolResult(undefined)).toBe("done");
  });

  test("never exceeds the cap", () => {
    const text = summarizeToolResult("y".repeat(5000), 100);
    expect(text.length).toBeLessThanOrEqual(100);
  });
});
