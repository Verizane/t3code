import path from "node:path";

import { describe, expect, it } from "vitest";

import { withUserLocalBunPath } from "./os-jank";

describe("withUserLocalBunPath", () => {
  it("prepends ~/.bun/bin when bun exists and PATH is missing it", () => {
    const homeDir = "/home/tester";

    expect(withUserLocalBunPath("/usr/local/bin:/usr/bin", homeDir, true)).toBe(
      [path.join(homeDir, ".bun/bin"), "/usr/local/bin", "/usr/bin"].join(path.delimiter),
    );
  });

  it("keeps PATH unchanged when ~/.bun/bin is already present", () => {
    const homeDir = "/home/tester";
    const bunBinDir = path.join(homeDir, ".bun/bin");
    const currentPath = [bunBinDir, "/usr/local/bin", "/usr/bin"].join(path.delimiter);

    expect(withUserLocalBunPath(currentPath, homeDir, true)).toBe(currentPath);
  });

  it("keeps PATH unchanged when bun is not installed", () => {
    expect(withUserLocalBunPath("/usr/local/bin:/usr/bin", "/home/tester", false)).toBe(
      "/usr/local/bin:/usr/bin",
    );
  });
});
