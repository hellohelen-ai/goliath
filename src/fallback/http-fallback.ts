import type { Fallback, FallbackRequest } from "../types.js";

type HttpFallbackOptions = {
  url: string;
  /** Static headers, or a function when the token rotates. */
  headers?: Record<string, string> | (() => Promise<Record<string, string>>);
  /** Override for tests. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Pull the answer text out of the response body. Default reads `{ text }`. */
  readText?: (body: unknown) => string;
};

type FallbackPayload = Omit<FallbackRequest, "signal">;

/**
 * Send the turn to a server as JSON and read back `{ text }`. The payload is
 * exactly what the conductor saw, so the cloud agent starts where the phone
 * stopped instead of from scratch.
 */
const httpFallback = (options: HttpFallbackOptions): Fallback => {
  const doFetch = options.fetch ?? fetch;
  const readText = options.readText ?? defaultReadText;

  return async (request) => {
    const { signal, ...payload } = request;
    const headers =
      typeof options.headers === "function" ? await options.headers() : (options.headers ?? {});
    const response = await doFetch(options.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(payload satisfies FallbackPayload),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) {
      throw new Error(`httpFallback: ${response.status} from ${options.url}`);
    }
    const body: unknown = await response.json();
    return { text: readText(body) };
  };
};

const defaultReadText = (body: unknown): string => {
  if (typeof body === "object" && body !== null && "text" in body) {
    const text = (body as { text: unknown }).text;
    if (typeof text === "string") return text;
  }
  throw new Error("httpFallback: response had no `text` string");
};

export { httpFallback };
export type { FallbackPayload, HttpFallbackOptions };
