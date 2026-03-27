import * as fs from "node:fs";
import OS from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { resolveCommandForSpawn } from "./bunCommandResolution";

describe("resolveCommandForSpawn", () => {
  it("resolves bun from the login shell PATH on linux when the inherited PATH misses it", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");

    const tempRoot = fs.mkdtempSync(path.join(OS.tmpdir(), "bun-command-resolution-"));
    const bunBinDir = path.join(tempRoot, ".bun", "bin");
    fs.mkdirSync(bunBinDir, { recursive: true });
    fs.writeFileSync(path.join(bunBinDir, "bun"), "");

    const resolved = resolveCommandForSpawn(
      "bun",
      {
        PATH: "/usr/bin:/bin",
        SHELL: "/bin/bash",
      },
      () => ({ PATH: `${bunBinDir}:/usr/bin:/bin` }),
    );

    expect(resolved).toBe(path.join(bunBinDir, "bun"));

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("leaves non-bun commands untouched", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");

    const resolved = resolveCommandForSpawn(
      "git",
      {
        PATH: "/usr/bin:/bin",
        SHELL: "/bin/bash",
      },
      () => ({ PATH: "/home/test/.bun/bin:/usr/bin:/bin" }),
    );

    expect(resolved).toBe("git");
  });
});
