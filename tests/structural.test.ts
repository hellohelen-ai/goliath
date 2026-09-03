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

  test("long arrays show a head, an omitted count, and a tail", () => {
    const text = summarizeToolResult(Array.from({ length: 12 }, (_, i) => `item ${i}`));
    expect(text.split("\n")).toEqual([
      "1. item 0",
      "2. item 1",
      "3. item 2",
      "4. item 3",
      "5. item 4",
      "… 5 omitted",
      "11. item 10",
      "12. item 11",
    ]);
  });

  test("an error line in the omitted middle survives the cut", () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      id: i,
      status: i === 9 ? "failed: quota" : "ok",
    }));
    const text = summarizeToolResult(items);
    expect(text).toContain("10. id: 9, status: failed: quota");
    expect(text).toContain("… 13 omitted");
    expect(text.split("\n")).toHaveLength(9);
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
