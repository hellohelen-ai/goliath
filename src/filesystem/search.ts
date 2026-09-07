import { filePath, within } from "./paths.js";
import { checkAbort } from "../context.js";
import { countResult, fitPrefix, type ResultBudget } from "../tool-output.js";
import { decodeCursor, encodeCursor } from "./cursor.js";
import { globMatcher } from "./glob.js";
import type { FilesystemBackend } from "./types.js";

type Match = { path: string; revision: string; line?: number; excerpt?: string };
export type SearchResult = { matches: Match[]; nextCursor: string | null };
export const formatSearch = (result: SearchResult) => JSON.stringify(result);

export async function search(
  backend: FilesystemBackend,
  options: {
    kind: "glob" | "grep";
    root: string;
    pattern: string;
    ignoreCase: boolean;
    cursor?: string | undefined;
    maxMatches: number;
    maxFiles: number;
    signal?: AbortSignal | undefined;
  },
  budget: ResultBudget,
): Promise<SearchResult> {
  const query = JSON.stringify([options.kind, options.root, options.pattern, options.ignoreCase]);
  const state = decodeCursor(options.cursor, query);
  if (state.after && !within(filePath(state.after), options.root))
    throw new Error("Cursor is outside the search root.");
  const matches: Match[] = [];
  const matcher = options.kind === "glob" ? globMatcher(options.pattern) : undefined;
  const needle = options.ignoreCase ? options.pattern.toLowerCase() : options.pattern;
  let scanned = 0,
    characters = 0;
  const token = () => encodeCursor(state);
  const result = async (more: boolean): Promise<SearchResult> => {
    const value = { matches, nextCursor: more ? token() : null };
    if ((await countResult(formatSearch(value), budget)) > budget.maxTokens)
      throw new Error("Tool result budget is too small for search metadata.");
    return value;
  };
  const append = async (match: Match) => {
    const trial = { matches: [...matches, match], nextCursor: token() };
    if ((await countResult(formatSearch(trial), budget)) > budget.maxTokens - 16) {
      if (matches.length) return false;
      if (match.excerpt !== undefined) {
        const render = (excerpt: string) =>
          formatSearch({
            matches: [{ ...match, excerpt }],
            nextCursor: token(),
          });
        const length = await fitPrefix(match.excerpt, render, {
          ...budget,
          maxTokens: budget.maxTokens - 16,
        });
        match = { ...match, excerpt: match.excerpt.slice(0, length) };
      } else
        throw new Error(
          "Tool result budget is too small for a search match; narrow the query or increase the budget.",
        );
    }
    matches.push(match);
    return true;
  };
  // A cursor in a file resumes that file; otherwise after is the last completed path.
  let pending = state.revision ? [{ path: state.after, revision: state.revision }] : [];
  while (scanned < options.maxFiles && characters < 65536) {
    checkAbort(options.signal);
    if (!pending.length) {
      const page = await backend.list(options.root, {
        after: state.after,
        limit: 1,
        ...(options.signal ? { signal: options.signal } : {}),
      });
      if (!page.files.length) return result(false);
      pending = page.files;
    }
    const file = pending.shift()!;
    if (options.kind === "glob") {
      const previous = { ...state };
      state.after = file.path;
      if (matcher!(file.path) && !(await append(file))) {
        Object.assign(state, previous);
        return result(true);
      }
      scanned++;
    } else {
      const entry = await backend.read(file.path, options.signal);
      if (state.revision && state.revision !== entry.revision)
        throw new Error("File changed; restart the search without a cursor.");
      state.after = file.path;
      state.revision = entry.revision;
      if (state.position > entry.content.length) throw new Error("Invalid search cursor position.");
      while (state.position < entry.content.length && characters < 65536) {
        checkAbort(options.signal);
        const start = state.position;
        const newline = entry.content.indexOf("\n", start);
        const end = newline < 0 ? entry.content.length : newline;
        const text = entry.content.slice(start, end);
        const haystack = options.ignoreCase ? text.toLowerCase() : text;
        const found = haystack.indexOf(needle);
        if (found >= 0) {
          let excerptStart = Math.max(0, found - 30);
          if (/[\uDC00-\uDFFF]/.test(text[excerptStart] ?? "")) excerptStart--;
          const excerpt = Array.from(text.slice(excerptStart)).slice(0, 100).join("");
          const match = {
            path: file.path,
            revision: entry.revision,
            line: entry.content.slice(0, start).split("\n").length,
            excerpt,
          };
          if (!(await append(match))) return result(true);
        }
        state.position = newline < 0 ? end : end + 1;
        characters += end - start + 1;
        if (matches.length >= options.maxMatches) return result(true);
      }
      if (state.position < entry.content.length) return result(true);
      state.position = 0;
      state.revision = "";
      scanned++;
    }
    if (matches.length >= options.maxMatches) return result(true);
  }
  return result(true);
}
