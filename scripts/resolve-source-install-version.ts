import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  normalizeForkBaseVersion,
  resolveReleasePackageBaseVersion,
} from "./resolve-fork-release-version.ts";

interface ResolveSourceInstallVersionOptions {
  readonly rootDir?: string;
  readonly baseVersion?: string;
  readonly number?: number;
}

export function resolveSourceInstallVersion(
  options: ResolveSourceInstallVersionOptions = {},
): string {
  const rootDir = resolve(options.rootDir ?? process.cwd());
  const baseVersion =
    options.baseVersion === undefined
      ? resolveReleasePackageBaseVersion(rootDir)
      : normalizeForkBaseVersion(options.baseVersion);

  if (options.number !== undefined) {
    if (!Number.isInteger(options.number) || options.number < 1) {
      throw new Error(`Invalid source rebuild number: ${options.number}`);
    }

    return `${baseVersion}-source-${options.number}`;
  }

  return `${baseVersion}-source`;
}

function parseArgs(argv: ReadonlyArray<string>): ResolveSourceInstallVersionOptions {
  let rootDir: string | undefined;
  let baseVersion: string | undefined;
  let number: number | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) {
      continue;
    }

    if (argument === "--root") {
      rootDir = argv[index + 1];
      if (!rootDir) {
        throw new Error("Missing value for --root.");
      }
      index += 1;
      continue;
    }

    if (argument === "--base-version") {
      baseVersion = argv[index + 1];
      if (!baseVersion) {
        throw new Error("Missing value for --base-version.");
      }
      index += 1;
      continue;
    }

    if (argument === "--number" || argument === "-n") {
      const rawNumber = argv[index + 1];
      if (!rawNumber) {
        throw new Error("Missing value for --number.");
      }

      if (!/^\d+$/u.test(rawNumber)) {
        throw new Error(`Invalid source rebuild number: ${rawNumber}`);
      }

      number = Number.parseInt(rawNumber, 10);
      if (!Number.isInteger(number) || number < 1) {
        throw new Error(`Invalid source rebuild number: ${rawNumber}`);
      }
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return {
    ...(rootDir === undefined ? {} : { rootDir }),
    ...(baseVersion === undefined ? {} : { baseVersion }),
    ...(number === undefined ? {} : { number }),
  };
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  console.log(resolveSourceInstallVersion(parseArgs(process.argv.slice(2))));
}
