import { NoObjectGeneratedError } from "ai";

/** Providers may wrap the native error more than once. Never inspect tool output here. */
function messages(error: unknown): string[] {
  const result: string[] = [];
  const seen = new Set<unknown>();
  let current = error;
  for (let depth = 0; current != null && depth < 8 && !seen.has(current); depth++) {
    seen.add(current);
    if (typeof current === "string") {
      result.push(current);
      break;
    }
    if (typeof current !== "object") break;
    if ("message" in current && typeof current.message === "string") result.push(current.message);
    current = "cause" in current ? current.cause : undefined;
  }
  return result;
}

export function isGuardrail(error: unknown): boolean {
  return messages(error).some((message) =>
    /guardrail|content.?filter|safety|detected content likely to be unsafe/i.test(message),
  );
}

/** A malformed native Generable plan can use the existing bounded validation retry. */
export function isInvalidModelOutput(error: unknown): boolean {
  if (isGuardrail(error)) return false;
  return (
    NoObjectGeneratedError.isInstance(error) ||
    messages(error).some((message) =>
      /failed to deserialize a Generable type from model output/i.test(message),
    )
  );
}
