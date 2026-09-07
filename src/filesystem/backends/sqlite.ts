import { checkAbort } from "../../context.js";
import { checkContent, filePath, normalizePath, pageLimit, revision } from "../paths.js";
import type { FileEntry, FilesystemBackend, FilesystemDatabase } from "../types.js";

export function sqliteFilesystem(
  database: FilesystemDatabase | Promise<FilesystemDatabase> | (() => Promise<FilesystemDatabase>),
  { namespace = "default" }: { namespace?: string } = {},
): FilesystemBackend {
  if (!namespace.trim()) throw new Error("Filesystem namespace must not be empty.");
  let ready: Promise<FilesystemDatabase> | undefined;
  const connect = () =>
    (ready ??= Promise.resolve()
      .then(() => (typeof database === "function" ? database() : database))
      .then(async (db) => {
        await db.execAsync(`CREATE TABLE IF NOT EXISTS goliath_files_v1 (
      namespace TEXT NOT NULL, path TEXT NOT NULL, path_key TEXT NOT NULL, content TEXT NOT NULL, revision TEXT NOT NULL,
      PRIMARY KEY (namespace, path)
    ); CREATE INDEX IF NOT EXISTS goliath_files_order_v1 ON goliath_files_v1(namespace, path_key);`);
        return db;
      })
      .catch((error) => {
        ready = undefined;
        throw error;
      }));
  return {
    async read(path, signal) {
      checkAbort(signal);
      const db = await connect();
      const [entry] = await db.getAllAsync<FileEntry>(
        "SELECT path, content, revision FROM goliath_files_v1 WHERE namespace = ? AND path = ?",
        namespace,
        filePath(path),
      );
      checkAbort(signal);
      if (!entry) throw new Error(`File not found: ${path}`);
      checkContent(entry.content);
      return entry;
    },
    async list(path, options = {}) {
      checkAbort(options.signal);
      const root = normalizePath(path);
      const limit = pageLimit(options.limit);
      const db = await connect();
      const rows = await db.getAllAsync<{ path: string; revision: string }>(
        `SELECT path, revision FROM goliath_files_v1 WHERE namespace = ? AND path_key > ?
         AND (path = ? OR substr(path, 1, length(?)) = ?) ORDER BY path_key LIMIT ?`,
        namespace,
        pathKey(options.after ?? ""),
        root,
        root === "/" ? "/" : `${root}/`,
        root === "/" ? "/" : `${root}/`,
        limit + 1,
      );
      checkAbort(options.signal);
      const files = rows.slice(0, limit);
      return { files, next: rows.length > limit ? files.at(-1)!.path : null };
    },
    async write(path, content, options) {
      checkAbort(options.signal);
      const key = filePath(path);
      checkContent(content);
      const db = await connect();
      checkAbort(options.signal);
      const next = revision();
      // Compare-and-swap is one SQL statement, so other app processes cannot race the revision check.
      const result =
        options.expectedRevision === null
          ? await db.runAsync(
              "INSERT INTO goliath_files_v1 (namespace, path, path_key, content, revision) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
              namespace,
              key,
              pathKey(key),
              content,
              next,
            )
          : await db.runAsync(
              "UPDATE goliath_files_v1 SET content = ?, revision = ? WHERE namespace = ? AND path = ? AND revision = ?",
              content,
              next,
              namespace,
              key,
              options.expectedRevision,
            );
      if (!result.changes)
        throw new Error("File changed; read its current revision before writing.");
      return { path: key, revision: next };
    },
    async remove(path, options) {
      checkAbort(options.signal);
      const db = await connect();
      checkAbort(options.signal);
      const result = await db.runAsync(
        "DELETE FROM goliath_files_v1 WHERE namespace = ? AND path = ? AND revision = ?",
        namespace,
        filePath(path),
        options.expectedRevision,
      );
      if (!result.changes) throw new Error("File changed or is missing; read it before deleting.");
    },
  };
}

// Preserve the same lexicographic ordering as JavaScript, including supplementary Unicode.
const pathKey = (path: string): string => {
  let key = "";
  for (let i = 0; i < path.length; i++) key += path.charCodeAt(i).toString(16).padStart(4, "0");
  return key;
};
