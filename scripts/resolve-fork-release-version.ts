import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { releasePackageFiles } from "./update-release-package-versions.ts";

const RELEASE_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$/;
const FORK_RELEASE_PATTERN = /-fork-(\d+)$/;

interface ResolveForkReleaseVersionOptions {
  readonly rootDir?: string;
  readonly baseVersion?: string;
  readonly tags?: ReadonlyArray<string>;
}

interface ForkReleaseMetadata {
  readonly baseVersion: string;
  readonly version: string;
  readonly tag: string;
  readonly isPrerelease: boolean;
  readonly makeLatest: boolean;
}

interface MutablePackageJson {
  version?: string;
  [key: string]: unknown;
}

function normalizeVersionPrefix(version: string): string {
  return version.trim().replace(/^v/, "");
}

export function normalizeForkBaseVersion(version: string): string {
  const normalizedVersion = normalizeVersionPrefix(version);
  return normalizedVersion.replace(FORK_RELEASE_PATTERN, "");
}

function assertReleaseVersion(version: string, label: string): void {
  if (!RELEASE_VERSION_PATTERN.test(version)) {
    throw new Error(`Invalid ${label}: ${version}`);
  }
}

function escapeRegex(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readReleasePackageVersions(rootDir: string): ReadonlyArray<string> {
  return releasePackageFiles.map((relativePath) => {
    const filePath = resolve(rootDir, relativePath);
    const packageJson = JSON.parse(readFileSync(filePath, "utf8")) as MutablePackageJson;

    if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
      throw new Error(`Missing package version in ${relativePath}.`);
    }

    return packageJson.version;
  });
}

function resolveBaseVersionFromWorkspace(rootDir: string): string {
  const normalizedVersions = [
    ...new Set(readReleasePackageVersions(rootDir).map((version) => normalizeForkBaseVersion(version))),
  ];

  if (normalizedVersions.length !== 1) {
    throw new Error(
      `Release package versions must match before resolving a fork release. Found: ${normalizedVersions.join(", ")}`,
    );
  }

  const [baseVersion] = normalizedVersions;
  if (!baseVersion) {
    throw new Error("Could not resolve a base release version from workspace package.json files.");
  }

  assertReleaseVersion(baseVersion, "base version");
  return baseVersion;
}

function listGitTags(rootDir: string): ReadonlyArray<string> {
  const stdout = execFileSync("git", ["tag", "--list"], {
    cwd: rootDir,
    encoding: "utf8",
  });

  return stdout
    .split(/\r?\n/u)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

export function resolveNextForkReleaseVersion(
  baseVersion: string,
  tags: ReadonlyArray<string>,
): string {
  const normalizedBaseVersion = normalizeForkBaseVersion(baseVersion);
  assertReleaseVersion(normalizedBaseVersion, "base version");

  const matcher = new RegExp(`^v?${escapeRegex(normalizedBaseVersion)}-fork-(\\d+)$`, "u");
  let maxForkNumber = 0;

  for (const tag of tags) {
    const match = matcher.exec(tag.trim());
    if (!match) {
      continue;
    }

    const forkNumber = Number.parseInt(match[1] ?? "", 10);
    if (!Number.isNaN(forkNumber)) {
      maxForkNumber = Math.max(maxForkNumber, forkNumber);
    }
  }

  return `${normalizedBaseVersion}-fork-${maxForkNumber + 1}`;
}

export function resolveForkReleaseMetadata(
  options: ResolveForkReleaseVersionOptions = {},
): ForkReleaseMetadata {
  const rootDir = resolve(options.rootDir ?? process.cwd());
  const baseVersion = options.baseVersion
    ? normalizeForkBaseVersion(options.baseVersion)
    : resolveBaseVersionFromWorkspace(rootDir);

  assertReleaseVersion(baseVersion, "base version");

  const tags = options.tags ?? listGitTags(rootDir);
  const version = resolveNextForkReleaseVersion(baseVersion, tags);

  return {
    baseVersion,
    version,
    tag: `v${version}`,
    isPrerelease: true,
    makeLatest: false,
  };
}

function parseArgs(argv: ReadonlyArray<string>): {
  rootDir: string | undefined;
  baseVersion: string | undefined;
  writeGithubOutput: boolean;
} {
  let rootDir: string | undefined;
  let baseVersion: string | undefined;
  let writeGithubOutput = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) {
      continue;
    }

    if (argument === "--github-output") {
      writeGithubOutput = true;
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

    throw new Error(`Unknown argument: ${argument}`);
  }

  return { rootDir, baseVersion, writeGithubOutput };
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const { rootDir, baseVersion, writeGithubOutput } = parseArgs(process.argv.slice(2));
  const metadata = resolveForkReleaseMetadata({
    ...(rootDir === undefined ? {} : { rootDir }),
    ...(baseVersion === undefined ? {} : { baseVersion }),
  });

  console.log(metadata.version);

  if (writeGithubOutput) {
    const githubOutputPath = process.env.GITHUB_OUTPUT;
    if (!githubOutputPath) {
      throw new Error("GITHUB_OUTPUT is required when --github-output is set.");
    }

    appendFileSync(githubOutputPath, `base_version=${metadata.baseVersion}\n`);
    appendFileSync(githubOutputPath, `version=${metadata.version}\n`);
    appendFileSync(githubOutputPath, `tag=${metadata.tag}\n`);
    appendFileSync(githubOutputPath, `is_prerelease=${metadata.isPrerelease}\n`);
    appendFileSync(githubOutputPath, `make_latest=${metadata.makeLatest}\n`);
  }
}
