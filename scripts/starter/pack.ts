import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { exportStarter } from "./export.js";
import { run } from "./process.js";

export function pack(directory: string, output: string): string {
  const [result] = JSON.parse(
    run("npm", ["pack", "--json", "--pack-destination", output], directory, true),
  );
  if (!result?.filename) throw new Error("npm pack did not produce a tarball");
  return join(output, result.filename);
}

export async function packStarter(destination: string): Promise<string> {
  const output = resolve(destination);
  await mkdir(output, { recursive: true });
  const work = await mkdtemp(join(tmpdir(), "goliath-template-"));
  try {
    const source = join(work, "template");
    await exportStarter(source);
    return pack(source, output);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const output = process.argv[2];
  if (!output || process.argv.length !== 3)
    throw new Error("Usage: bun run starter:pack <artifact-directory>");
  console.log(await packStarter(output));
}
