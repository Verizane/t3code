import * as OS from "node:os";
import { existsSync } from "node:fs";
import path from "node:path";
import { Effect, Path } from "effect";
import { readPathFromLoginShell, resolveLoginShell } from "@t3tools/shared/shell";

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

export function fixPath(
  options: {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    readPath?: typeof readPathFromLoginShell;
  } = {},
): void {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin" && platform !== "linux") return;

  const env = options.env ?? process.env;
  const homeDir = OS.homedir();

  try {
    const shell = resolveLoginShell(platform, env.SHELL);
    if (!shell) return;
    const result = (options.readPath ?? readPathFromLoginShell)(shell);
    if (result) {
      env.PATH = withUserLocalBunPath(result, homeDir);
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
