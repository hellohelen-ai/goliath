/**
 * Turn a tool result into the fewest characters the model still needs.
 * JSON becomes `key: value` lines, arrays become numbered lines, long
 * strings get cut. No model call, so this runs on every result.
 */
const DEFAULT_MAX_CHARS = 600;
/** Long lists show the first items, a count, and the last items (deepagents, Grok Bot). */
const HEAD_ITEMS = 5;
const TAIL_ITEMS = 2;
const MAX_ITEMS = HEAD_ITEMS + TAIL_ITEMS;
const MAX_VALUE_CHARS = 80;
/** A line that looks like a failure survives any cut (OpenClaw's diagnostic tail). */
const ERROR_LINE = /\b(error|exception|failed|fatal|denied|timed?\s?out)\b/i;

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

const scalar = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return clip(value, MAX_VALUE_CHARS);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const lineFor = (value: unknown): string => {
  if (isRecord(value)) {
    return Object.entries(value)
      .map(([key, item]) => {
        const text = scalar(item);
        return text ? `${key}: ${text}` : "";
      })
      .filter(Boolean)
      .join(", ");
  }
  return scalar(value);
};

const summarizeToolResult = (value: unknown, maxChars = DEFAULT_MAX_CHARS): string => {
  if (value === undefined || value === null) return "done";
  if (typeof value === "string") return value.trim() ? clip(value, maxChars) : "(no output)";
  if (Array.isArray(value)) {
    if (value.length === 0) return "none";
    const line = (item: unknown, i: number) => `${i + 1}. ${lineFor(item)}`;
    if (value.length <= MAX_ITEMS) return clip(value.map(line).join("\n"), maxChars);
    const head = value.slice(0, HEAD_ITEMS).map(line);
    const tail = value
      .slice(-TAIL_ITEMS)
      .map((item, i) => line(item, value.length - TAIL_ITEMS + i));
    const omitted = value
      .slice(HEAD_ITEMS, -TAIL_ITEMS)
      .map((item, i) => line(item, HEAD_ITEMS + i))
      .filter((text) => ERROR_LINE.test(text));
    const shown = [...head, `… ${value.length - MAX_ITEMS} omitted`, ...omitted, ...tail];
    return clip(shown.join("\n"), maxChars);
  }
  if (isRecord(value)) {
    const lines = Object.entries(value).map(([key, item]) =>
      Array.isArray(item) || isRecord(item)
        ? `${key}: ${lineFor(item) || summarizeToolResult(item, MAX_VALUE_CHARS)}`
        : `${key}: ${scalar(item)}`,
    );
    return clip(lines.join("\n"), maxChars);
  }
  return clip(String(value), maxChars);
};

export { summarizeToolResult, clip };
