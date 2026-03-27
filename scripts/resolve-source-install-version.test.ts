import { describe, expect, it } from "vitest";

import { resolveSourceInstallVersion } from "./resolve-source-install-version.ts";

describe("resolveSourceInstallVersion", () => {
  it("uses the base release version for forked versions", () => {
    expect(resolveSourceInstallVersion({ baseVersion: "0.0.14-fork-7" })).toBe("0.0.14-source");
  });

  it("strips a leading v prefix before applying the source suffix", () => {
    expect(resolveSourceInstallVersion({ baseVersion: "v0.1.0-beta.2" })).toBe(
      "0.1.0-beta.2-source",
    );
  });

  it("appends the rebuild number when provided", () => {
    expect(resolveSourceInstallVersion({ baseVersion: "0.1.0", number: 3 })).toBe("0.1.0-source-3");
  });
});
