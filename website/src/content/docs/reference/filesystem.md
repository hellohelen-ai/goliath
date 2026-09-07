---
title: Filesystem
description: Storage adapters, routes, tools, cursors, and configuration.
---

Import these APIs from `@hellohelen-ai/goliath/filesystem`. See the
[virtual files guide](/goliath/guides/filesystem/) for complete examples.

## `createFilesystem(options?)`

Returns `{ tools: ToolMap }` for `createAgent({ model, tools: files.tools })`.

| Option              | Default                      | Meaning                                                                   |
| ------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| `backend`           | Empty `inMemoryFilesystem()` | Backend or async `(context: ToolContext) => backend`                      |
| `root`              | `"/"`                        | Restrict all tool access to this virtual directory; paths remain absolute |
| `readOnly`          | `true`                       | Set false to allow registration of write tools                            |
| `tools`             | All permitted tools          | Choose tool names; requesting writes while read-only throws               |
| `read.defaultLines` | `25`                         | Requested lines when omitted by model                                     |
| `read.maxLines`     | `200`                        | Maximum requested lines; configurable up to 1,000                         |
| `search.maxMatches` | `10`                         | Matches per page; configurable up to 100                                  |
| `search.maxFiles`   | `128`                        | Files inspected per call; configurable up to 1,024                        |

Paths are absolute virtual paths, limited to 512 UTF-16 code units. Dot segments, backslashes,
and control characters are rejected. Repeated slashes normalize. There are no symlinks, host file
access, binary files, or shell commands.

## Tools

All arguments are flat objects. Optional arguments can be omitted.

| Tool         | Arguments                                    | Result                                                         |
| ------------ | -------------------------------------------- | -------------------------------------------------------------- |
| `glob`       | `pattern`, `cursor?`                         | `{ matches: [{ path, revision }], nextCursor }`                |
| `grep`       | `pattern`, `path?`, `ignoreCase?`, `cursor?` | `{ matches: [{ path, revision, line, excerpt }], nextCursor }` |
| `readFile`   | `path`, `offset?`, `limit?`, `cursor?`       | `{ path, revision, line, continued, content, nextCursor }`     |
| `writeFile`  | `path`, `content`, `revision?`               | `{ path, revision }`                                           |
| `editFile`   | `path`, `revision`, `oldText`, `newText`     | `{ path, revision }`                                           |
| `deleteFile` | `path`, `revision`                           | `{ path, deleted: true }`                                      |

Glob supports `*` within a path segment, `**` across directories, and `?` for one non-slash
character. `/**/*.md` includes root files. Other characters are literal; there is no brace,
character-class, or regex syntax. Matching uses bounded dynamic programming.

Grep searches literal text, case-insensitive by default, with one match per matching line.
Excerpts show up to 100 Unicode code points around the first occurrence; use `readFile` for
the full line. Patterns are limited to 256 code units. Read offsets are zero-based; reported line
numbers are one-based. Do not combine a read cursor with an offset.

Cursors are opaque continuation values, not credentials. Pass them unchanged and follow until
null. They bind to the query and, when paused inside a file, its revision. Listing changes between
pages can affect search results. A file that changes or disappears may require a fresh query.

The three write tools set `writes: true` and `requiresConfirmation: true`. Writes are absent
unless explicitly enabled. An omitted write revision means create-only; it never replaces a file.
An edit requires exactly one occurrence of `oldText`, including rejecting overlapping matches.

## Backend contract

```ts
type FilesystemBackend = {
  read(path: string, signal?: AbortSignal): Promise<FileEntry>;
  list(path: string, options?: ListOptions): Promise<FilePage>;
  write?(path: string, content: string, options: WriteOptions): Promise<FileInfo>;
  remove?(path: string, options: WriteOptions): Promise<void>;
};

type FileEntry = { path: string; revision: string; content: string };
type FileInfo = { path: string; revision: string };
type FilePage = { files: FileInfo[]; next: string | null };
type ListOptions = { after?: string; limit?: number; signal?: AbortSignal };
type WriteOptions = { expectedRevision: string | null; signal?: AbortSignal };
```

`list` recursively lists file metadata under a directory (or one exact file path), sorted by
JavaScript string ordering. `after` is an exclusive path cursor. The default limit is 64; maximum 256. Return the last returned path as `next` only when more files exist. Missing reads throw.
Revisions must change on each mutation, including delete-and-recreate. Custom backends must
enforce their own size, path, authorization, cancellation, and atomic revision-check rules.

`staticFilesystem(files)` snapshots the input map and exposes only read/list.
`inMemoryFilesystem(files?)` snapshots the same format and adds writes.
Built-in backends cap files at 1 MiB; directories are implicit path prefixes.

## SQLite

```ts
sqliteFilesystem(database, { namespace: "default" });
```

`database` can be a connection, promise, or lazy async connection factory:

```ts
type FilesystemDatabase = {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: (string | number | null)[]): Promise<{ changes: number }>;
  getAllAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T[]>;
};
```

Expo SQLite implements this interface. Other drivers can use a small wrapper.
Initialization is lazy. A failing connection factory can retry on the next operation.
The caller owns the connection and its lifecycle. Namespaces isolate rows in the same table;
the same database and namespace deliberately share files.

## Composite routes

```ts
compositeFilesystem({
  default: scratch,
  routes: {
    "/notes": persistent,
    "/reference": { backend: documents, readOnly: true },
  },
});
```

The longest matching directory prefix selects a backend. The prefix is removed on delegation
and restored in results. Searches merge visible paths in global lexical order and hide shadowed
entries. Routes apply to reads, listing, writes, and deletes. Use `default` for the root; duplicate
normalized routes throw. The router exposes mutation methods but rejects mutations of read-only
routes or backends lacking the relevant method.

Composite listing may inspect additional metadata to skip shadowed entries. It is not an index
and cannot promise constant work for arbitrarily many hidden files.
