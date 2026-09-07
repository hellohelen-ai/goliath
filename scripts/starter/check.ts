import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { repository, templateName } from "./export.js";
import { pack, packStarter } from "./pack.js";
import { run } from "./process.js";

// Keep the scaffold CLI fixed so upstream CLI changes do not silently change the test.
const createExpoApp = "create-expo-app@4.0.0";
const destination = process.argv[2];
if (!destination || process.argv.length !== 3)
  throw new Error("Usage: bun run starter:check <artifact-directory>");
const work = await mkdtemp(join(tmpdir(), "goliath-starter-check-"));
const output = resolve(destination);
await mkdir(output, { recursive: true });
try {
  const template = await packStarter(output);
  const sdk = pack(repository, output);
  run(
    "npx",
    ["--yes", createExpoApp, "sdk-starter-smoke", "--template", template, "--no-install", "--yes"],
    work,
  );
  const app = join(work, "sdk-starter-smoke");
  const manifest = JSON.parse(await readFile(join(app, "package.json"), "utf8"));
  const expected = JSON.parse(await readFile(join(repository, "package.json"), "utf8"));
  assert.equal(manifest.name, "sdk-starter-smoke");
  assert.notEqual(manifest.name, templateName);
  assert.equal(manifest.private, true);
  assert.equal(manifest.dependencies[expected.name], expected.version);
  const metro = await readFile(join(app, "metro.config.js"), "utf8");
  assert.ok(!metro.includes("resolveRequest") && !metro.includes("../src"));
  await lstat(join(app, "modules/goliath-context/ios/GoliathContextModule.swift"));
  await lstat(join(app, "assets/stone.svg"));
  await lstat(join(app, ".gitignore"));

  // Override only the SDK dependency. The scaffold still exercises the exported template bytes.
  run("bun", ["add", "--exact", sdk], app);
  const installed = join(app, "node_modules/@hellohelen-ai/goliath");
  assert.equal((await lstat(installed)).isSymbolicLink(), false);
  assert.equal(
    JSON.parse(await readFile(join(installed, "package.json"), "utf8")).version,
    expected.version,
  );
  const native = JSON.parse(
    run(
      "bunx",
      ["--no-install", "expo-modules-autolinking", "resolve", "--platform", "apple", "--json"],
      app,
      true,
    ),
  );
  assert.ok(
    native.modules.some(
      (module: { packageName: string; modules: string[] }) =>
        module.packageName === "goliath-context" && module.modules.includes("GoliathContextModule"),
    ),
    "The starter must autolink its native context module",
  );
  for (const command of ["typecheck", "test", "doctor", "bundle"])
    run("bun", ["run", command], app);
  console.log(`Starter passed outside the checkout using the packed SDK. Artifacts: ${output}`);
} finally {
  await rm(work, { recursive: true, force: true });
}
