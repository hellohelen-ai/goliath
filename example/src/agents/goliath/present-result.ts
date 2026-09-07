import type { RunResult } from "@hellohelen-ai/goliath";

/** Translate recorded outcomes, not provider error strings, into the conversation UI. */
export function presentResult(result: RunResult) {
  const escalation = result.trace.findLast((event) => event.type === "escalate");
  const partial = !!result.bestEffort;
  const empty = !result.text.trim();
  const incomplete = !!result.stopped || partial || empty;
  let notice: string | undefined;
  let explanation = "The assistant couldn’t finish this request.";

  if (result.stopped) {
    notice = "Request stopped";
    explanation = result.stopped.reason;
  } else if (incomplete) {
    switch (escalation?.reason) {
      case "guardrail":
        notice = "Apple Intelligence declined";
        explanation = "Apple Intelligence declined this request.";
        break;
      case "repeated-tool-call":
        notice = "Stopped a repeated step";
        explanation = "The assistant kept requesting the same action, so this turn was stopped.";
        break;
      case "plan-invalid":
      case "tool-args-invalid":
      case "answer-invalid":
        notice = "Couldn’t interpret the model’s response";
        explanation = "The model returned a response the app couldn’t use.";
        break;
      case "context-budget":
        notice = "Context limit reached";
        explanation = "This request and its context didn’t fit in the model’s available space.";
        break;
      case "model-error":
      case "no-model":
      case "model-unavailable":
        notice = "Model couldn’t finish";
        explanation = "The on-device model couldn’t complete this request.";
        break;
      case "too-many-steps":
        notice = "Step limit reached";
        explanation = "The assistant reached this turn’s step limit.";
        break;
      case "tool-prerequisite-missing":
        notice = "A required lookup was missed";
        explanation = "The assistant skipped a lookup it needed before taking that action.";
        break;
      case "tool-error":
        notice = "An action failed";
        explanation = "The assistant couldn’t complete an action.";
        break;
      default:
        notice = "Request unfinished";
    }
  }

  const attempted = result.steps.filter(
    (step) => step.kind === "tool" && !step.skipped && !step.cached,
  );
  const succeeded = attempted.filter((step) => !step.failed);
  const effects = !attempted.length
    ? "No action ran."
    : succeeded.length
      ? "Earlier actions may have completed; check the conversation before retrying."
      : "An action was attempted; check its outcome before retrying.";

  return {
    text: empty ? `${explanation} ${effects}` : result.text,
    notice,
    incomplete,
    footer: `${result.handledBy === "device" ? "On-device" : "Cloud"} · ${incomplete ? "Unfinished · " : ""}${result.steps.length} ${result.steps.length === 1 ? "step" : "steps"}`,
  };
}
