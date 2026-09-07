import { z } from "zod";

const schema = z
  .object({
    query: z.string(),
    after: z.string(),
    position: z.number().int().nonnegative(),
    revision: z.string(),
  })
  .strict();
export type Cursor = z.infer<typeof schema>;
export const encodeCursor = (cursor: Cursor) => JSON.stringify(cursor);
export function decodeCursor(value: string | undefined, query: string): Cursor {
  if (!value) return { query, after: "", position: 0, revision: "" };
  if (value.length > 4096) throw new Error("Invalid cursor.");
  const cursor = schema.parse(JSON.parse(value));
  if (cursor.query !== query) throw new Error("Cursor belongs to a different query.");
  return cursor;
}
