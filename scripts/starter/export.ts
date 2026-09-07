import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const repository = fileURLToPath(new URL("../../", import.meta.url));
export const templateName = "@hellohelen-ai/expo-template-goliath";
const example = join(repository, "example");
const extensions = new Set([".ts", ".tsx", ".js", ".cjs", ".json", ".swift", ".podspec", ".svg"]);

async function copySource(source: string, destination: string): Promise<void> {
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw new Error(`Starter source must not be a symlink: ${source}`);
  if (info.isDirectory()) {
    await mkdir(destination, { recursive: true });
    for (const entry of await readdir(source)) {
      if (entry.startsWith(".") || entry === "node_modules") continue;
      await copySource(join(source, entry), join(destination, entry));
    }
  } else {
    if (!extensions.has(extname(source))) throw new Error(`Unsupported starter source: ${source}`);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
}

/** Export one standalone app from the example; never overwrite an existing project. */
export async function exportStarter(destination: string): Promise<void> {
  const output = resolve(destination);
  const insideExample = relative(example, output);
  if (!insideExample || (insideExample !== ".." && !insideExample.startsWith(".." + sep)))
    throw new Error("Export outside example/ to avoid copying the output into itself.");
  await mkdir(output, { recursive: false });
  for (const directory of ["app", "src", "modules", "tests"]) {
    await copySource(join(example, directory), join(output, directory));
  }
  for (const name of ["tsconfig.json", ".gitignore"]) {
    await copyFile(join(example, name), join(output, name));
  }
  // The example's wrapper watches the SDK source; the exported config only uses installed packages.
  await copyFile(join(example, "metro.base.cjs"), join(output, "metro.config.js"));
  await mkdir(join(output, "assets"));
  await copyFile(join(repository, "website/src/assets/logo.svg"), join(output, "assets/stone.svg"));
  const mark = join(output, "src/ui/agent-mark.tsx");
  const source = await readFile(mark, "utf8");
  const original = '"../../../website/src/assets/logo.svg"';
  if (!source.includes(original))
    throw new Error("Update the starter's logo mapping after changing AgentMark.");
  await writeFile(mark, source.replace(original, '"../../assets/stone.svg"'));

  const sdk = JSON.parse(await readFile(join(repository, "package.json"), "utf8"));
  const app = JSON.parse(await readFile(join(example, "package.json"), "utf8"));
  app.name = templateName;
  app.version = sdk.version;
  app.private = true;
  app.description =
    "An Expo starter with Goliath, on-device tools, conversations, and local storage.";
  app.license = "MIT";
  app.repository = sdk.repository;
  app.dependencies[sdk.name] = sdk.version;
  app.files = [
    "app",
    "src",
    "modules",
    "tests",
    "assets",
    "app.json",
    "metro.config.js",
    "tsconfig.json",
    ".gitignore",
    "README.md",
    "LICENSE",
  ];
  await writeFile(join(output, "package.json"), JSON.stringify(app, null, 2) + "\n");
  const config = JSON.parse(await readFile(join(example, "app.json"), "utf8"));
  config.expo.name = "Goliath Starter";
  config.expo.slug = "goliath-starter";
  config.expo.scheme = "goliath-starter";
  config.expo.version = "1.0.0";
  // Expo prompts for a personal bundle identifier on the first device build.
  delete config.expo.ios.bundleIdentifier;
  await writeFile(join(output, "app.json"), JSON.stringify(config, null, 2) + "\n");
  await copyFile(join(repository, "scripts/starter/README.md"), join(output, "README.md"));
  await copyFile(join(repository, "LICENSE"), join(output, "LICENSE"));
}

if (import.meta.main) {
  const destination = process.argv[2];
  if (!destination || process.argv.length !== 3)
    throw new Error("Usage: bun run starter:export <new-directory>");
  await exportStarter(destination);
  console.log(`Starter exported to ${resolve(destination)}`);
}
