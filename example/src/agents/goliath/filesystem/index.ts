import { createFilesystem } from "@hellohelen-ai/goliath/filesystem";
import { openDatabaseAsync } from "expo-sqlite";
import { createFileBackend } from "./backend";

// A separate connection keeps file writes out of the conversation store's transactions.
export const files = createFilesystem({
  backend: createFileBackend(() => openDatabaseAsync("goliath-files.db")),
  readOnly: false,
  tools: ["glob", "grep", "readFile", "writeFile", "editFile"],
});
