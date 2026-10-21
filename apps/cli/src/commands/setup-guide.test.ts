import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REPOSITORY_URL, SETUP_GUIDE_PATH } from "./init.js";

/**
 * `init` prints a link to the setup guide, and a link printed into a terminal is the one piece of
 * documentation nobody notices has rotted. This one shipped with the owner name misspelled, which
 * only surfaced when someone clicked it.
 *
 * The owner and repository cannot be checked without the network, which the privacy rules forbid in
 * tests. What can be checked is everything else: that the path still exists in this repo, and that
 * the URL agrees with the repository recorded in the root `package.json`.
 */
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

describe("the setup guide link", () => {
  it("points at a file that exists in this repository", () => {
    expect(existsSync(`${REPO_ROOT}${SETUP_GUIDE_PATH}`)).toBe(true);
  });

  it("agrees with the repository in package.json, so a rename cannot leave it behind", () => {
    const manifest: unknown = JSON.parse(readFileSync(`${REPO_ROOT}package.json`, "utf8"));
    const url = (manifest as { repository?: { url?: string } }).repository?.url ?? "";

    // `git+https://github.com/owner/repo.git` and `https://github.com/owner/repo` must name the
    // same place.
    const normalized = url.replace(/^git\+/, "").replace(/\.git$/, "");

    expect(normalized).toBe(REPOSITORY_URL);
  });

  it("names the owner as it is actually spelled", () => {
    // The bug was `jadermoura` for `jader-moura`, so the hyphen is worth pinning.
    expect(REPOSITORY_URL).toContain("jader-moura");
  });
});
