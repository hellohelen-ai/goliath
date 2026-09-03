import { describe, expect, test } from "bun:test";
import { RECENT_KEEP, remember } from "../src/scribe.js";
import { fakeModel } from "../src/testing/index.js";

const exchange = (n: number) => ({ ask: `ask ${n}`, answer: `answer ${n}`, at: n });

describe("remember", () => {
  test("keeps recent exchanges verbatim and costs no model call", async () => {
    const model = fakeModel([]);
    const next = await remember({
      model,
      state: { summary: "", recent: [] },
      exchange: exchange(1),
      summaryBudget: 500,
    });
    expect(next.recent).toEqual([exchange(1)]);
    expect(next.summary).toBe("");
    expect(model.calls).toHaveLength(0);
  });

  test("folds the evicted exchange into the brief with one call", async () => {
    const model = fakeModel([{ text: "User asked 0; assistant answered 0." }]);
    const recent = Array.from({ length: RECENT_KEEP }, (_, i) => exchange(i));
    const next = await remember({
      model,
      state: { summary: "", recent },
      exchange: exchange(RECENT_KEEP),
      summaryBudget: 500,
    });
    expect(next.recent).toHaveLength(RECENT_KEEP);
    expect(next.recent[0]).toEqual(exchange(1));
    expect(next.summary).toBe("User asked 0; assistant answered 0.");
    expect(model.calls).toHaveLength(1);
    expect(JSON.stringify(model.calls[0]?.prompt)).toContain("ask 0");
  });

  test("an empty scribe reply keeps the old brief", async () => {
    const model = fakeModel([{ text: "   " }]);
    const recent = Array.from({ length: RECENT_KEEP }, (_, i) => exchange(i));
    const next = await remember({
      model,
      state: { summary: "old brief", recent },
      exchange: exchange(9),
      summaryBudget: 500,
    });
    expect(next.summary).toBe("old brief");
  });
});
