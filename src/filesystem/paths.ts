/** Paths are virtual and never passed to the host filesystem. */
export function normalizePath(path: string): string {
  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    path.length > 512 ||
    /[\\\x00-\x1f\x7f]/.test(path)
  )
    throw new Error("Use an absolute virtual path of at most 512 characters.");
  const parts = path.split("/").filter(Boolean);
  if (parts.some((part) => part === ".." || part === "."))
    throw new Error("Relative path segments are not allowed.");
  return `/${parts.join("/")}`;
}
export function filePath(path: string): string {
  const result = normalizePath(path);
  if (result === "/") throw new Error("Expected a file path, not the root directory.");
  return result;
}
export const within = (path: string, root: string): boolean =>
  root === "/" || path === root || path.startsWith(`${root}/`);
export function pageLimit(value = 64): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 256)
    throw new Error("List limit must be between 1 and 256.");
  return value;
}
let sequence = 0;
export const revision = (): string =>
  `${Date.now().toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
export function checkContent(content: string, maxBytes = 1024 * 1024): void {
  let bytes = 0;
  for (const char of content) {
    const point = char.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes > maxBytes) throw new Error(`File exceeds the ${maxBytes}-byte limit.`);
  }
}
