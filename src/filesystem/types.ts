import type { ToolContext } from "../types.js";

export type FileEntry = { path: string; revision: string; content: string };
export type FileInfo = Omit<FileEntry, "content">;
export type FilePage = { files: FileInfo[]; next: string | null };
export type ListOptions = { after?: string; limit?: number; signal?: AbortSignal };
export type WriteOptions = {
  /** null means create only; a revision means replace only that version. */
  expectedRevision: string | null;
  signal?: AbortSignal;
};

/** Virtual absolute paths; list is recursive and sorted by path using JS string ordering. */
export type FilesystemBackend = {
  read: (path: string, signal?: AbortSignal) => Promise<FileEntry>;
  list: (path: string, options?: ListOptions) => Promise<FilePage>;
  write?: (path: string, content: string, options: WriteOptions) => Promise<FileInfo>;
  remove?: (path: string, options: WriteOptions) => Promise<void>;
};
export type FilesystemSource =
  FilesystemBackend | ((context: ToolContext) => FilesystemBackend | Promise<FilesystemBackend>);
export type FilesystemRoute =
  FilesystemBackend | { backend: FilesystemBackend; readOnly?: boolean };
export type FileSeeds = Record<string, string>;

/** Compatible with Expo SQLite and small wrappers around Bun or other SQLite drivers. */
export type FilesystemDatabase = {
  execAsync: (sql: string) => Promise<void>;
  runAsync: (sql: string, ...params: (string | number | null)[]) => Promise<{ changes: number }>;
  getAllAsync: <T>(sql: string, ...params: (string | number | null)[]) => Promise<T[]>;
};
