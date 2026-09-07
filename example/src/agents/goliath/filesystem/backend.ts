import {
  compositeFilesystem,
  inMemoryFilesystem,
  sqliteFilesystem,
  staticFilesystem,
  type FilesystemBackend,
  type FilesystemDatabase,
} from "@hellohelen-ai/goliath/filesystem";
import { documents } from "./documents";

// Persisted notes are shared by this app's conversations. Scratch files are scoped by ID.
export function createFileBackend(database: () => Promise<FilesystemDatabase>) {
  const notes = sqliteFilesystem(database, { namespace: "notes" });
  const docs = staticFilesystem(documents);
  const conversations = new Map<string | undefined, FilesystemBackend>();
  return ({ conversationId }: { conversationId?: string }) => {
    let backend = conversations.get(conversationId);
    if (!backend) {
      backend = compositeFilesystem({
        default: inMemoryFilesystem(),
        routes: { "/notes": notes, "/docs": docs },
      });
      conversations.set(conversationId, backend);
    }
    return backend;
  };
}
