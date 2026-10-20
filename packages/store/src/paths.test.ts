import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDataDirectory, resolveDatabasePath, type PathEnvironment } from "./paths.js";

function environment(overrides: Partial<PathEnvironment> = {}): PathEnvironment {
  return { platform: "linux", env: {}, home: "/home/u", ...overrides };
}

describe("resolveDataDirectory", () => {
  it("uses LOCALAPPDATA on Windows", () => {
    const dir = resolveDataDirectory(
      environment({
        platform: "win32",
        env: { LOCALAPPDATA: "C:/Users/u/AppData/Local" },
        home: "C:/Users/u",
      }),
    );

    expect(dir).toBe(join("C:/Users/u/AppData/Local", "cleamail"));
  });

  it("falls back to the home directory when LOCALAPPDATA is missing", () => {
    const dir = resolveDataDirectory(environment({ platform: "win32", home: "C:/Users/u" }));

    expect(dir).toBe(join("C:/Users/u", "AppData", "Local", "cleamail"));
  });

  it("uses Application Support on macOS", () => {
    const dir = resolveDataDirectory(environment({ platform: "darwin" }));

    expect(dir).toBe(join("/home/u", "Library", "Application Support", "cleamail"));
  });

  it("honours XDG_DATA_HOME on Linux", () => {
    const dir = resolveDataDirectory(environment({ env: { XDG_DATA_HOME: "/data" } }));

    expect(dir).toBe(join("/data", "cleamail"));
  });

  it("defaults to ~/.local/share on Linux", () => {
    expect(resolveDataDirectory(environment())).toBe(
      join("/home/u", ".local", "share", "cleamail"),
    );
  });
});

describe("resolveDatabasePath", () => {
  it("puts the database inside the data directory", () => {
    expect(resolveDatabasePath(environment())).toBe(
      join("/home/u", ".local", "share", "cleamail", "cleamail.sqlite"),
    );
  });

  it("lets CLEAMAIL_DB override everything", () => {
    expect(resolveDatabasePath(environment({ env: { CLEAMAIL_DB: "/tmp/eval.sqlite" } }))).toBe(
      "/tmp/eval.sqlite",
    );
  });

  it("ignores an empty override", () => {
    expect(resolveDatabasePath(environment({ env: { CLEAMAIL_DB: "" } }))).toContain(
      "cleamail.sqlite",
    );
  });
});
