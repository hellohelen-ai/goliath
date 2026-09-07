import { fitPrefix, type ResultBudget } from "../tool-output.js";
import { decodeCursor, encodeCursor } from "./cursor.js";
import type { FileEntry } from "./types.js";

export type ReadResult = {
  path: string;
  revision: string;
  line: number;
  continued: boolean;
  nextCursor: string | null;
  content: string;
};
export const formatRead = (result: ReadResult): string =>
  JSON.stringify({
    path: result.path,
    revision: result.revision,
    line: result.line,
    continued: result.continued,
    nextCursor: result.nextCursor,
  }) +
  "\n" +
  result.content;

export async function readPage(
  entry: FileEntry,
  options: { offset?: number | undefined; limit: number; cursor?: string | undefined },
  budget: ResultBudget,
): Promise<ReadResult> {
  if (options.cursor && options.offset !== undefined)
    throw new Error("Use offset or cursor, not both.");
  const query = JSON.stringify(["read", entry.path]);
  const cursor = decodeCursor(options.cursor, query);
  if (options.cursor && cursor.revision !== entry.revision)
    throw new Error("File changed; restart reading without a cursor.");
  let start = cursor.position;
  if (!options.cursor) {
    start = 0;
    for (let line = 0; line < (options.offset ?? 0); line++) {
      const next = entry.content.indexOf("\n", start);
      if (next < 0) {
        start = entry.content.length;
        break;
      }
      start = next + 1;
    }
  }
  if (
    start > entry.content.length ||
    (start > 0 && /[\uDC00-\uDFFF]/.test(entry.content[start] ?? ""))
  )
    throw new Error("Invalid read cursor position.");
  let end = start;
  for (let line = 0; line < options.limit; line++) {
    const next = entry.content.indexOf("\n", end);
    if (next < 0) {
      end = entry.content.length;
      break;
    }
    end = next + 1;
  }
  const line = entry.content.slice(0, start).split("\n").length;
  const make = (content: string): ReadResult => ({
    path: entry.path,
    revision: entry.revision,
    line,
    continued: start > 0 && entry.content[start - 1] !== "\n",
    nextCursor:
      start + content.length < entry.content.length
        ? encodeCursor({
            query,
            after: "",
            position: start + content.length,
            revision: entry.revision,
          })
        : null,
    content,
  });
  // Cap the candidate before tokenizing; backends cap individual files at 1 MiB.
  let candidateEnd = Math.min(end, start + 16384);
  if (/[\uDC00-\uDFFF]/.test(entry.content[candidateEnd] ?? "")) candidateEnd--;
  const candidate = entry.content.slice(start, candidateEnd);
  const length = await fitPrefix(candidate, (prefix) => formatRead(make(prefix)), budget);
  if (!length && start < entry.content.length)
    throw new Error("Tool result budget is too small to read content.");
  return make(candidate.slice(0, length));
}
