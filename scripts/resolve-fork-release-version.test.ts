import { describe, expect, it } from "vitest";

import {
  normalizeForkBaseVersion,
  resolveForkReleaseMetadata,
  resolveNextForkReleaseVersion,
} from "./resolve-fork-release-version.ts";

describe("normalizeForkBaseVersion", () => {
  it("strips a leading v prefix and existing fork suffix", () => {
    expect(normalizeForkBaseVersion("v0.0.9-fork-4")).toBe("0.0.9");
  });

  it("preserves prerelease base versions", () => {
    expect(normalizeForkBaseVersion("0.1.0-beta.2")).toBe("0.1.0-beta.2");
  });
});

describe("resolveNextForkReleaseVersion", () => {
  it("starts at fork-1 when no prior fork tags exist", () => {
    expect(resolveNextForkReleaseVersion("0.0.9", ["v0.0.8-fork-3", "v0.0.9"])).toBe(
      "0.0.9-fork-1",
    );
  });

  it("increments from the highest matching fork tag", () => {
    expect(
      resolveNextForkReleaseVersion("0.0.9", [
        "v0.0.9-fork-2",
        "v0.0.9-fork-10",
        "v0.0.10-fork-1",
        "junk",
      ]),
    ).toBe("0.0.9-fork-11");
  });
});

describe("resolveForkReleaseMetadata", () => {
  it("marks fork releases as prereleases and never latest", () => {
    expect(
      resolveForkReleaseMetadata({
        baseVersion: "v0.0.9",
        tags: ["v0.0.9-fork-1"],
      }),
    ).toEqual({
      baseVersion: "0.0.9",
      version: "0.0.9-fork-2",
      tag: "v0.0.9-fork-2",
      isPrerelease: true,
      makeLatest: false,
    });
  });
});
