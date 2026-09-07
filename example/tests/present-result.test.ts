import { expect, test } from "bun:test";
import type { RunResult } from "@hellohelen-ai/goliath";
import { presentResult } from "../src/agents/goliath/present-result";
import { createAppStore } from "../src/stores/app-store";

const result = (patch: Partial<RunResult>): RunResult => ({
  text: "",
  handledBy: "device",
  steps: [],
  trace: [],
  ...patch,
});
test("a refusal explains the screenshot's zero-step outcome without suggesting a smaller request", () => {
  const refusal = result({ trace: [{ type: "escalate", reason: "guardrail" }] });
  const display = presentResult(refusal);
  expect(display.notice).toBe("Apple Intelligence declined");
  expect(display.text).toBe("Apple Intelligence declined this request. No action ran.");
  expect(display.footer).toBe("On-device · Unfinished · 0 steps");
  const store = createAppStore();
  const address = { conversationId: "first", messageId: "reply" };
  store.getState().startTurn(address, "Mark the task done.");
  store.getState().completeTurn(address, refusal);
  expect(store.getState().conversations[0].messages.at(-1)?.text).toBe(display.text);
});
test("loop recovery shows the returned facts and a precise notice", () => {
  const display = presentResult(
    result({
      bestEffort: true,
      text: "Renew the passport is open.",
      trace: [{ type: "escalate", reason: "repeated-tool-call" }],
    }),
  );
  expect(display.notice).toBe("Stopped a repeated step");
  expect(display.text).toBe("Renew the passport is open.");
  expect(display.incomplete).toBe(true);
});
test("a later model failure never implies an earlier write did not happen or is safe to retry", () => {
  const display = presentResult(
    result({
      steps: [
        {
          index: 0,
          kind: "tool",
          brief: "Save",
          tool: "write",
          writes: true,
          result: "saved",
          output: { ok: true },
        },
      ],
      trace: [{ type: "escalate", reason: "model-error" }],
    }),
  );
  expect(display.text).toContain("Earlier actions may have completed");
  expect(display.text).not.toContain("No action ran");
});
test("cloud recovery, normal answers, and policy stops have distinct presentation", () => {
  expect(
    presentResult(
      result({
        text: "Done.",
        handledBy: "cloud",
        trace: [{ type: "escalate", reason: "model-error" }],
      }),
    ).notice,
  ).toBeUndefined();
  expect(presentResult(result({ text: "Hello." })).incomplete).toBe(false);
  expect(
    presentResult(
      result({
        stopped: { extension: "policy", phase: "beforeRun", reason: "Paused by app policy" },
      }),
    ).text,
  ).toContain("Paused by app policy");
});
test("a failed tool may have partially applied an effect", () => {
  const display = presentResult(
    result({
      steps: [{ index: 0, kind: "tool", tool: "write", brief: "", writes: true, failed: true }],
      trace: [{ type: "escalate", reason: "tool-error" }],
    }),
  );
  expect(display.text).toContain("An action was attempted");
  expect(display.text).not.toContain("No action ran");
});
