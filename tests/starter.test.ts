import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportStarter, repository, templateName } from "../scripts/starter/export.js";

const temporary: string[] = [];
afterEach(async () => {
  for (const directory of temporary.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function workspace() {
  const directory = await mkdtemp(join(tmpdir(), "goliath-export-test-"));
  temporary.push(directory);
  return directory;
}

test("exported starter carries its assets, native module and tests without repository dependencies", async () => {
  const destination = join(await workspace(), "app");
  await exportStarter(destination);
  const manifest = JSON.parse(await readFile(join(destination, "package.json"), "utf8"));
  const sdk = JSON.parse(await readFile(join(repository, "package.json"), "utf8"));
  expect(manifest.name).toBe(templateName);
  expect(manifest.private).toBeUndefined();
  expect(manifest.devDependencies["@types/bun"]).toBeDefined();
  expect(manifest.dependencies[sdk.name]).toBe(sdk.version);
  expect(
    Object.values(manifest.dependencies).some((value) => String(value).startsWith("file:")),
  ).toBe(false);
  const files = await readdir(destination, { recursive: true });
  expect(files).toContain("assets/stone.svg");
  expect(files).toContain("modules/goliath-context/ios/GoliathContextModule.swift");
  expect(files).toContain("tests/task-tools.test.ts");
  for (const unwanted of [
    "node_modules",
    "ios",
    ".expo",
    ".expo-export",
    "bun.lock",
    "expo-env.d.ts",
    "metro.base.cjs",
  ])
    expect(files).not.toContain(unwanted);
  expect(await readFile(join(destination, "src/ui/agent-mark.tsx"), "utf8")).toContain(
    '"../../assets/stone.svg"',
  );
  const config = await readFile(join(destination, "metro.config.js"), "utf8");
  expect(config).not.toContain("resolveRequest");
  expect(config).not.toContain("../src");
  const app = JSON.parse(await readFile(join(destination, "app.json"), "utf8"));
  expect(app.expo.ios.bundleIdentifier).toBeUndefined();
  expect(app.expo.plugins).toContain("expo-sqlite");
});

test("export refuses an existing app without modifying it", async () => {
  const destination = await workspace();
  await writeFile(join(destination, "package.json"), '"keep my app"');
  await expect(exportStarter(destination)).rejects.toThrow();
  expect(await readFile(join(destination, "package.json"), "utf8")).toBe('"keep my app"');
});

test("export refuses a destination inside its source tree", async () => {
  await expect(exportStarter(join(repository, "example/src/generated-starter"))).rejects.toThrow(
    "Export outside example/",
  );
});
