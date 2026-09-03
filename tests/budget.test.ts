import { describe, expect, test } from "bun:test";
import type { ModelMessage } from "ai";
import { estimateTokens, fitWithin, transcriptTokens } from "../src/budget.js";

describe("estimateTokens", () => {
  test("runs near chars/4 with a safety margin", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a".repeat(400))).toBe(115);
  });
});

describe("fitWithin", () => {
  const system: ModelMessage = { role: "system", content: "s".repeat(40) };
  const old: ModelMessage = { role: "user", content: "o".repeat(400) };
  const mid: ModelMessage = { role: "assistant", content: "m".repeat(400) };
  const last: ModelMessage = { role: "user", content: "l".repeat(40) };

  test("drops the oldest non-system messages first", () => {
    const kept = fitWithin([system, old, mid, last], 100);
    expect(kept.map((m) => m.role)).toEqual(["system", "user"]);
    expect(kept[1]).toBe(last);
  });

  test("keeps everything when it fits", () => {
    const all = [system, old, mid, last];
    expect(fitWithin(all, 10_000)).toEqual(all);
  });

  test("never drops the last message, even over budget", () => {
    const kept = fitWithin([old, last], 1);
    expect(kept).toEqual([last]);
    expect(transcriptTokens(kept)).toBeGreaterThan(1);
  });
});
