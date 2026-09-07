import type { FileSeeds, FilesystemBackend } from "../types.js";
import { inMemoryFilesystem } from "./in-memory.js";

/** Predefined files. Contents are copied and mutation methods are deliberately absent. */
export function staticFilesystem(files: FileSeeds): FilesystemBackend {
  const { read, list } = inMemoryFilesystem(files);
  return { read, list };
}
