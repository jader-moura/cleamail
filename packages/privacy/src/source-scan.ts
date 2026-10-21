import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { normalizeHost } from "./allowlist.js";

/**
 * Finds every absolute URL written in the source.
 *
 * A URL in source is not proof of a network call, and a network call is not always written as a
 * literal, so this scan is the second half of the guard rather than the whole of it: the runtime
 * guard proves what the code does, and this proves that no new host has quietly appeared anywhere
 * in the repository, including in the dashboard's HTML when it arrives.
 */

const URL_PATTERN = /\bhttps?:\/\/[^\s"'`<>)\]},\\]+/g;

const SKIP_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "coverage",
  ".turbo",
  ".git",
  "migrations",
]);

/**
 * Tests and fixtures are skipped by default. They are where the counter-examples live: a test that
 * proves a CDN is blocked has to name that CDN, and an eval fixture is a synthetic email that may
 * well contain links. Neither ships, and the runtime guard is what covers behaviour.
 */
const TEST_DIRECTORIES = new Set(["test", "tests", "__tests__", "fixtures", "__fixtures__"]);

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs", ".html", ".css"];

export type ScanOptions = {
  /** Include test files and fixtures, which name hosts on purpose. */
  readonly includeTests?: boolean;
};

export type UrlMention = {
  readonly file: string;
  readonly line: number;
  readonly url: string;
  readonly host: string;
};

function isSourceFile(path: string): boolean {
  return SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension));
}

export function listSourceFiles(
  root: string,
  options: ScanOptions = {},
  into: string[] = [],
): string[] {
  for (const entry of readdirSync(root)) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    if (options.includeTests !== true && TEST_DIRECTORIES.has(entry)) continue;

    const path = join(root, entry);

    if (statSync(path).isDirectory()) {
      listSourceFiles(path, options, into);
      continue;
    }

    if (options.includeTests !== true && TEST_FILE.test(entry)) continue;
    if (isSourceFile(path)) into.push(path);
  }

  return into;
}

export function findUrlMentions(root: string, options: ScanOptions = {}): UrlMention[] {
  const mentions: UrlMention[] = [];

  for (const file of listSourceFiles(root, options)) {
    const contents = readFileSync(file, "utf8");
    if (!contents.includes("http")) continue;

    contents.split("\n").forEach((text, index) => {
      for (const match of text.matchAll(URL_PATTERN)) {
        const url = match[0];
        let host: string;

        try {
          host = normalizeHost(new URL(url).hostname);
        } catch {
          continue;
        }

        // Template placeholders are not hosts. `https://${host}/path` is the JavaScript form, and
        // `https://{domain}/path` is the one the eval scenarios use before expansion. Neither is a
        // place anything can connect to, and the expanded dataset is data rather than source.
        if (host === "" || /[${}]/.test(host)) continue;

        mentions.push({ file: relative(root, file), line: index + 1, url, host });
      }
    });
  }

  return mentions;
}

/** Mentions whose host is on neither list: the ones a human has to look at. */
export function unknownHosts(
  mentions: readonly UrlMention[],
  allowed: readonly string[],
): UrlMention[] {
  const known = new Set(allowed.map((host) => normalizeHost(host)));

  return mentions.filter((mention) => !known.has(mention.host));
}
