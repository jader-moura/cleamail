import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MENTION_ONLY_HOSTS, NETWORK_ALLOWED_HOSTS } from "./allowlist.js";
import { findExternalAssets } from "./html-scan.js";
import { findUrlMentions, listSourceFiles, unknownHosts } from "./source-scan.js";

/** packages/privacy/src -> the repository root. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const KNOWN_HOSTS = [...NETWORK_ALLOWED_HOSTS, ...MENTION_ONLY_HOSTS];

describe("the repository itself", () => {
  it("mentions no host that is neither contacted nor documented", () => {
    const unknown = unknownHosts(findUrlMentions(REPO_ROOT), KNOWN_HOSTS);

    // A failure here is not necessarily a bug: it means a new host appeared and somebody has to
    // say which list it belongs on. That decision should never be made silently.
    expect(
      unknown.map((mention) => `${mention.file}:${mention.line} ${mention.host}`),
    ).toStrictEqual([]);
  });

  it("actually scans a meaningful number of files", () => {
    // Guards the guard: a broken walk that finds nothing would make the test above pass for free.
    expect(listSourceFiles(REPO_ROOT).length).toBeGreaterThan(30);
    expect(findUrlMentions(REPO_ROOT).length).toBeGreaterThan(3);
  });

  it("skips tests by default, and finds their counter-example hosts when asked", () => {
    const withTests = findUrlMentions(REPO_ROOT, { includeTests: true });

    expect(withTests.map((mention) => mention.host)).toContain("telemetry.example.com");
    expect(findUrlMentions(REPO_ROOT).map((mention) => mention.host)).not.toContain(
      "telemetry.example.com",
    );
  });
});

describe("findUrlMentions", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "cleamail-scan-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("reports the file, line and host of each URL", () => {
    writeFileSync(join(root, "a.ts"), 'const x = 1;\nfetch("https://cdn.example.com/lib.js");\n');

    expect(findUrlMentions(root)).toStrictEqual([
      {
        file: "a.ts",
        line: 2,
        url: "https://cdn.example.com/lib.js",
        host: "cdn.example.com",
      },
    ]);
  });

  it("looks inside HTML and CSS too, which is where fonts and CDNs hide", () => {
    writeFileSync(join(root, "index.html"), '<script src="https://cdn.example.com/x.js"></script>');
    writeFileSync(join(root, "style.css"), "@import url(https://fonts.example.com/f.css);");

    expect(
      findUrlMentions(root)
        .map((mention) => mention.host)
        .sort(),
    ).toStrictEqual(["cdn.example.com", "fonts.example.com"]);
  });

  it("skips build output and dependencies", () => {
    mkdirSync(join(root, "node_modules"));
    mkdirSync(join(root, "dist"));
    writeFileSync(join(root, "node_modules", "dep.js"), 'fetch("https://dep.example.com")');
    writeFileSync(join(root, "dist", "bundle.js"), 'fetch("https://built.example.com")');

    expect(findUrlMentions(root)).toStrictEqual([]);
  });

  it("ignores a templated host, which is not a host", () => {
    writeFileSync(join(root, "a.ts"), "const url = `https://${host}/path`;\n");

    expect(findUrlMentions(root)).toStrictEqual([]);
  });

  it("ignores a brace placeholder, which the eval scenarios use", () => {
    writeFileSync(join(root, "a.ts"), 'const url = "https://{domain}/unsubscribe";\n');

    expect(findUrlMentions(root)).toStrictEqual([]);
  });

  it("still flags a real host that merely sits next to a placeholder", () => {
    writeFileSync(
      join(root, "a.ts"),
      'const a = "https://{domain}/x";\nconst b = "https://cdn.example.com/lib.js";\n',
    );

    expect(findUrlMentions(root).map((mention) => mention.host)).toStrictEqual(["cdn.example.com"]);
  });

  it("flags an unknown host and clears a known one", () => {
    writeFileSync(
      join(root, "a.ts"),
      'fetch("https://gmail.googleapis.com/x");\nfetch("https://tracker.example.com/y");\n',
    );

    const unknown = unknownHosts(findUrlMentions(root), KNOWN_HOSTS);

    expect(unknown.map((mention) => mention.host)).toStrictEqual(["tracker.example.com"]);
  });
});

describe("findExternalAssets", () => {
  it("finds scripts, stylesheets, fonts and remote imports", () => {
    const html = `<!doctype html>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
      <script src="//cdn.example.com/analytics.js"></script>
      <style>@font-face { src: url("https://fonts.gstatic.com/s/inter.woff2"); }</style>
      <script type="module">import x from "https://esm.sh/x";</script>`;

    expect(findExternalAssets(html).map((asset) => asset.url)).toStrictEqual([
      "https://fonts.googleapis.com/css2?family=Inter",
      "//cdn.example.com/analytics.js",
      "https://esm.sh/x",
      "https://fonts.gstatic.com/s/inter.woff2",
    ]);
  });

  it("passes a page that bundles everything locally", () => {
    const html = `<!doctype html>
      <link rel="stylesheet" href="/assets/app.css">
      <script type="module" src="./assets/app.js"></script>
      <style>@font-face { src: url("/assets/inter.woff2"); }</style>`;

    expect(findExternalAssets(html)).toStrictEqual([]);
  });
});
