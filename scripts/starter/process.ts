import { spawnSync } from "node:child_process";

export function run(command: string, args: string[], cwd: string, capture = false): string {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, CI: "1", EXPO_NO_TELEMETRY: "1" },
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(" ")} failed (${result.status})`);
  return result.stdout ?? "";
}
