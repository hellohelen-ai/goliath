import { NoObjectGeneratedError } from "ai";
import type { EscalationReason } from "./types.js";

/** Providers may wrap the native error more than once. Never inspect tool output here. */
function causes(error: unknown): Array<{ message?: string; code?: string }> {
  const result: Array<{ message?: string; code?: string }> = [];
  const seen = new Set<unknown>();
  let current = error;
  for (let depth = 0; current != null && depth < 8 && !seen.has(current); depth++) {
    seen.add(current);
    if (typeof current === "string") {
      result.push({ message: current });
      break;
    }
    if (typeof current !== "object") break;
    result.push({
      ...("message" in current && typeof current.message === "string"
        ? { message: current.message }
        : {}),
      ...("code" in current && typeof current.code === "string" ? { code: current.code } : {}),
    });
    current = "cause" in current ? current.cause : undefined;
  }
  return result;
}

export function isGuardrail(error: unknown): boolean {
  return causes(error).some(({ message, code }) =>
    /guardrail|content.?filter|safety|detected content likely to be unsafe/i.test(
      `${code ?? ""} ${message ?? ""}`,
    ),
  );
}

/** Codes survive localized provider messages. Refusals take priority over wrapped errors. */
export function modelFailureReason(error: unknown): EscalationReason {
  if (isGuardrail(error)) return "guardrail";
  for (const { code } of causes(error)) {
    switch (code) {
      case "CONTEXT_WINDOW_EXCEEDED":
        return "context-budget";
      case "MODEL_UNAVAILABLE":
      case "UNSUPPORTED_OS":
        return "model-unavailable";
    }
  }
  return "model-error";
}

/** A malformed native Generable plan can use the existing bounded validation retry. */
export function isInvalidModelOutput(error: unknown): boolean {
  if (modelFailureReason(error) !== "model-error") return false;
  return (
    NoObjectGeneratedError.isInstance(error) ||
    causes(error).some(({ message }) =>
      /failed to deserialize a Generable type from model output/i.test(message ?? ""),
    )
  );
}
