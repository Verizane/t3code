import * as OS from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { fixPath, withUserLocalBunPath } from "./os-jank";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fixPath", () => {
  it("hydrates PATH on linux using the resolved login shell and bun bin", () => {
    const homeDir = OS.homedir();

    const env: NodeJS.ProcessEnv = {
      SHELL: "/bin/zsh",
      PATH: "/usr/bin",
    };
    const readPath = vi.fn(() => "/opt/homebrew/bin:/usr/bin");

    fixPath({
      env,
      platform: "linux",
      readPath,
    });

    expect(readPath).toHaveBeenCalledWith("/bin/zsh");
    expect(env.PATH).toBe(
      [path.join(homeDir, ".bun/bin"), "/opt/homebrew/bin", "/usr/bin"].join(path.delimiter),
    );
  });

  it("does nothing outside macOS and linux even when SHELL is set", () => {
    const env: NodeJS.ProcessEnv = {
      SHELL: "C:/Program Files/Git/bin/bash.exe",
      PATH: "C:\\Windows\\System32",
    };
    const readPath = vi.fn(() => "/usr/local/bin:/usr/bin");

    fixPath({
      env,
      platform: "win32",
      readPath,
    });

    expect(readPath).not.toHaveBeenCalled();
    expect(env.PATH).toBe("C:\\Windows\\System32");
  });
});

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
