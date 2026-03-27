import * as fs from "node:fs";
import path from "node:path";

import { readEnvironmentFromLoginShell, type ShellEnvironmentReader } from "@t3tools/shared/shell";

const BUN_COMMANDS = new Set(["bun", "bunx"]);

function splitPathEntries(pathValue: string | undefined): string[] {
  return (pathValue ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function findExecutable(command: string, pathValue: string | undefined): string | null {
  for (const entry of splitPathEntries(pathValue)) {
    const candidate = path.join(entry, command);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function resolveCommandForSpawn(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  readEnvironment: ShellEnvironmentReader = readEnvironmentFromLoginShell,
): string {
  if (process.platform !== "linux" || !BUN_COMMANDS.has(command) || command.includes(path.sep)) {
    return command;
  }

  const currentMatch = findExecutable(command, env.PATH);
  if (currentMatch) {
    return command;
  }

  try {
    const loginShellPath = readEnvironment(env.SHELL ?? "/bin/bash", ["PATH"]).PATH;
    return findExecutable(command, loginShellPath) ?? command;
  } catch {
    return command;
  }
}
