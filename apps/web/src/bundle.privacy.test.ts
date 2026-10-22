// @vitest-environment node
//
// A real build runs esbuild, and esbuild cannot run inside jsdom: its invariant check on
// TextEncoder fails across realms. This is the one test in the app that wants no DOM at all.
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { findExternalAssets } from "@cleamail/privacy";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";

/**
 * The second promise, checked against the thing that ships.
 *
 * The dashboard must bundle everything it needs: no CDN script, no font service, no analytics, no
 * source map fetched from somewhere. The guard in `packages/privacy` was written in SPEC-006 for
 * exactly this moment, and this is where it gets pointed at a real build.
 *
 * The build runs here rather than relying on `dist` being present, so the check cannot quietly
 * become a no-op on a machine that has not built the app.
 */
describe("the built dashboard", () => {
  let outDir: string;
  let files: string[];

  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), "cleamail-bundle-"));

    await build({
      root: process.cwd(),
      logLevel: "error",
      build: { outDir, emptyOutDir: true, sourcemap: false },
    });

    files = listFiles(outDir);
  }, 180_000);

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it("produces a page and its assets", () => {
    expect(files).toContain("index.html");
    expect(files.some((file) => file.endsWith(".js"))).toBe(true);
    expect(files.some((file) => file.endsWith(".css"))).toBe(true);
  });

  it("loads nothing from anywhere else", () => {
    for (const file of files) {
      if (!/\.(?:html|js|css)$/.test(file)) continue;

      const content = readFileSync(join(outDir, file), "utf8");

      expect(findExternalAssets(content), file).toStrictEqual([]);
    }
  });

  it("mentions no CDN, font service or analytics host", () => {
    // Named rather than pattern-matched: these are the hosts a dependency actually drags in, and a
    // reader of this test should be able to see which ones are being refused.
    const forbidden = [
      "fonts.googleapis.com",
      "fonts.gstatic.com",
      "cdn.jsdelivr.net",
      "unpkg.com",
      "cdnjs.cloudflare.com",
      "googletagmanager.com",
      "google-analytics.com",
      "sentry.io",
    ];

    for (const file of files) {
      const content = readFileSync(join(outDir, file), "utf8");

      for (const host of forbidden) {
        expect(content.includes(host), `${file} mentions ${host}`).toBe(false);
      }
    }
  });

  it("asks the browser for its assets by relative path, so any origin serves it", () => {
    const html = readFileSync(join(outDir, "index.html"), "utf8");

    for (const match of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
      const value = match[1] ?? "";

      expect(value.startsWith("./") || value.startsWith("/"), value).toBe(true);
    }
  });

  it("ships no source map, which would be a file nobody asked to serve", () => {
    expect(files.filter((file) => file.endsWith(".map"))).toStrictEqual([]);
  });
});

function listFiles(root: string, into: string[] = [], base = root): string[] {
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);

    if (statSync(path).isDirectory()) listFiles(path, into, base);
    else into.push(relative(base, path).split("\\").join("/"));
  }

  return into;
}
