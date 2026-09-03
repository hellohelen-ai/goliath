/**
 * Turn a tool result into the fewest characters the model still needs.
 * JSON becomes `key: value` lines, arrays become numbered lines, long
 * strings get cut. No model call, so this runs on every result.
 */
const DEFAULT_MAX_CHARS = 600;
const MAX_ITEMS = 8;
const MAX_VALUE_CHARS = 80;

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
  if (value === undefined) return "done";
  if (typeof value === "string") return clip(value, maxChars);
  if (Array.isArray(value)) {
    if (value.length === 0) return "none";
    const shown = value.slice(0, MAX_ITEMS).map((item, i) => `${i + 1}. ${lineFor(item)}`);
    if (value.length > MAX_ITEMS) shown.push(`…and ${value.length - MAX_ITEMS} more`);
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
