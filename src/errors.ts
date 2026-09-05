import { NoObjectGeneratedError } from "ai";
import type { ErrorOrigin } from "./extensions.js";
import { isAbort } from "./extensions.js";

class OperationError extends Error {
  constructor(
    readonly origin: ErrorOrigin,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = isAbort(cause) ? "AbortError" : "GoliathOperationError";
  }
}
const operation = async <T>(origin: ErrorOrigin, fn: () => T | Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof OperationError) throw error;
    throw new OperationError(origin, error);
  }
};
class ModelCallError extends OperationError {
  constructor(
    readonly role: "plan" | "arguments" | "answer" | "scribe",
    cause: unknown,
  ) {
    super("model", cause);
  }
}
const modelCall = async <T>(role: ModelCallError["role"], fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    if (isAbort(error)) throw new OperationError("model", error);
    if (NoObjectGeneratedError.isInstance(error)) throw error;
    throw new ModelCallError(role, error);
  }
};
class GoliathBudgetError extends Error {
  override readonly name = "GoliathBudgetError";
  constructor(
    readonly phase: string,
    readonly tokens: number,
    readonly limit: number,
  ) {
    super(`${phase} requires ${tokens} estimated tokens; budget is ${limit}`);
  }
}
export { operation, OperationError, ModelCallError, modelCall, GoliathBudgetError };
