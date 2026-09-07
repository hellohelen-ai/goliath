---
title: Virtual files
description: Give an agent searchable documents, persistent notes, and scoped scratch space.
---

Goliath's optional filesystem module gives tools access to virtual text files. The model discovers
paths with `glob`, finds literal text with `grep`, and reads small excerpts with `readFile`.
Files live in the backend you choose. These paths never access the host's filesystem.

## Start with read-only documents

```ts
import { createAgent } from "@hellohelen-ai/goliath";
import { createFilesystem, staticFilesystem } from "@hellohelen-ai/goliath/filesystem";

const files = createFilesystem({
  backend: staticFilesystem({
    "/guide.md": "# Gardening\nWater the basil on Tuesday.",
  }),
});
const agent = createAgent({ model, tools: files.tools });

await agent.run("When should I water the basil?");
```

The default tools are `glob`, `grep`, and `readFile`. There is no storage dependency to install.
Omitting `backend` creates an empty in-memory filesystem.

## Choose storage and routes

```ts
import { openDatabaseAsync } from "expo-sqlite";
import {
  createFilesystem,
  compositeFilesystem,
  inMemoryFilesystem,
  sqliteFilesystem,
  staticFilesystem,
} from "@hellohelen-ai/goliath/filesystem";

const backend = compositeFilesystem({
  default: inMemoryFilesystem(),
  routes: {
    "/notes": sqliteFilesystem(() => openDatabaseAsync("agent-files.db")),
    "/docs": staticFilesystem({ "/guide.md": "App-owned documentation." }),
  },
});
const files = createFilesystem({ backend });
```

| Backend                                      | Lifetime                                   | Writable             |
| -------------------------------------------- | ------------------------------------------ | -------------------- |
| `inMemoryFilesystem(initialFiles?)`          | Until the backend instance is discarded    | Yes                  |
| `sqliteFilesystem(database, { namespace? })` | Across launches, in your database          | Yes                  |
| `staticFilesystem(files)`                    | Snapshot of documents supplied by your app | No                   |
| `compositeFilesystem({ default, routes })`   | Delegates to each route                    | Depends on the route |

The longest directory prefix wins. `/notes/today.md` is `/today.md` inside the notes backend.
`/notes-other.md` uses the default backend. Mounted routes hide matching files in the default
backend, including during searches. Use `{ backend, readOnly: true }` to make any route read-only.

SQLite uses its own `goliath_files_v1` table and leaves `PRAGMA user_version` alone.
The library has no Expo dependency: supply an object implementing the small
[database interface](/goliath/reference/filesystem/). It does not close your connection.
Use a dedicated connection if your app also runs transactions that should not include agent writes.

## Decide what conversations share

Passing one backend to an agent shares its files across conversations. Conversation memory
is separate from file storage. For isolated scratch space, resolve a backend from the run context:

```ts
const conversations = new Map<string | undefined, ReturnType<typeof inMemoryFilesystem>>();
const files = createFilesystem({
  backend: ({ conversationId }) => {
    let backend = conversations.get(conversationId);
    if (!backend) {
      backend = inMemoryFilesystem();
      conversations.set(conversationId, backend);
    }
    return backend;
  },
});
```

For persistent isolation, select a SQLite namespace using a stable app-controlled user or
conversation ID. You can combine isolated scratch space with shared notes and static docs;
the example app demonstrates this. Dispose of cached backends when your application discards
the associated conversation.

Different installed apps do not share a database merely because they use the same agent
definition. Sharing requires deliberately connecting both apps to shared storage.
Namespaces separate records; they are not an authentication system. Choose scopes in trusted
application code, not from model arguments.

## Enable selected writes

```ts
const files = createFilesystem({
  backend,
  readOnly: false,
  tools: ["glob", "grep", "readFile", "writeFile", "editFile"],
});
const agent = createAgent({
  model,
  tools: files.tools,
  confirm: ({ tool, input }) => showApprovalDialog(tool, input),
});
```

Filesystem writes require an explicit config-level or per-run approval handler. Without one,
the harness declines them. A direct call to a backend or a tool's `execute` method is application
code and bypasses harness approval.

Creating a file omits `revision`. Replacing, editing, or deleting an existing file requires its
current revision from a read. SQLite checks the revision in the same statement that mutates the
file; a stale writer cannot overwrite a concurrent edit. Exact edits must match once.
`deleteFile` deletes a single file, never a directory tree.

## Read and search within the context window

`readFile` starts at a zero-based line `offset` and requests up to `limit` lines, defaulting to 25.
Its result includes the starting **one-based** `line`, literal `content`, `revision`, and
`nextCursor`. A long line can span multiple excerpts; `continued` identifies a fragment.

Pass `nextCursor` back unchanged to continue. A null cursor means completion.
Searches can return an empty page with a non-null cursor when the scan limit is reached.
A cursor is specific to its query; reads and searches paused inside a file also check its revision.
If that file changes, restart the query. Searches across files are a live view, not a snapshot.

Defaults are designed for a small model:

- At most 10 search matches per response, scanning at most 128 files per call.
- Grep pauses between lines after scanning about 64 Ki characters; one longer line is processed whole.
- At most 200 requested read lines. Token limits can return fewer lines.
- Built-in backends accept text files up to 1 MiB in UTF-8. Each read loads that file into application
  memory; pagination bounds what reaches the model, not database I/O.
- File results use `outputMode: "content"`: their default token allowance is one eighth of the
  model window, capped at 800 tokens. Active retrieved excerpts share one quarter of the window,
  capped at 2,000 tokens. Older excerpts are omitted from prompts while retained in the run result.

Provide `window` and `countTokens` from your model provider when available. These defaults scale
with its reported window; without a tokenizer, Goliath uses its conservative estimate.
The full prompt guard still reserves room for instructions, schemas, output, and provider framing.

Advanced overrides are optional:

```ts
const files = createFilesystem({
  backend,
  root: "/notes",
  read: { defaultLines: 15, maxLines: 100 },
  search: { maxMatches: 5, maxFiles: 64 },
});
const agent = createAgent({
  model,
  tools: files.tools,
  budgets: { toolResultTokens: 400, retrievedContextTokens: 900 },
});
```

A very small budget or unusually long path/query can leave no room for pagination metadata.
The tool then reports an error rather than returning an unusable cursor. Larger file collections
may need an indexed custom backend; built-in grep performs a bounded linear scan.
