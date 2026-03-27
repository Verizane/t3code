import * as OS from "node:os";
import { existsSync } from "node:fs";
import path from "node:path";
import { Effect, Path } from "effect";
import { readPathFromLoginShell } from "@t3tools/shared/shell";

export function withUserLocalBunPath(
  currentPath: string | undefined,
  homeDir: string,
  bunExists: boolean = existsSync(path.join(homeDir, ".bun/bin/bun")),
): string | undefined {
  if (!bunExists) return currentPath;

  const bunBinDir = path.join(homeDir, ".bun/bin");
  const pathEntries = (currentPath ?? "").split(path.delimiter).filter(Boolean);

  if (pathEntries.includes(bunBinDir)) {
    return currentPath;
  }

  return [bunBinDir, ...pathEntries].join(path.delimiter);
}

export function fixPath(): void {
  const homeDir = OS.homedir();

  if (process.platform === "linux") {
    process.env.PATH = withUserLocalBunPath(process.env.PATH, homeDir);
    return;
  }

  if (process.platform !== "darwin") return;

  try {
    const shell = process.env.SHELL ?? "/bin/zsh";
    const result = readPathFromLoginShell(shell);
    if (result) {
      process.env.PATH = withUserLocalBunPath(result, homeDir);
    }
  } catch {
    // Silently ignore — keep default PATH
  }
}

export const expandHomePath = Effect.fn(function* (input: string) {
  const { join } = yield* Path.Path;
  if (input === "~") {
    return OS.homedir();
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return join(OS.homedir(), input.slice(2));
  }
  return input;
});

export const resolveBaseDir = Effect.fn(function* (raw: string | undefined) {
  const { join, resolve } = yield* Path.Path;
  if (!raw || raw.trim().length === 0) {
    return join(OS.homedir(), ".t3");
  }
  return resolve(yield* expandHomePath(raw.trim()));
});
