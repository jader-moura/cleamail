/**
 * Checks a built HTML page for anything loaded from somewhere else.
 *
 * The dashboard must bundle its own assets: no CDN scripts, no external fonts, no analytics. This
 * runs over the real `apps/web` build from SPEC-014; until then it is covered by its own tests, so
 * the check is ready and proven before there is a bundle to point it at.
 */

const ATTRIBUTE_PATTERN = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
const IMPORT_PATTERN = /\b(?:import|from)\s+["'](https?:\/\/[^"']+)["']/gi;
const CSS_URL_PATTERN = /url\(\s*["']?(https?:\/\/[^"')]+)/gi;

export type ExternalAsset = {
  readonly url: string;
  readonly kind: "attribute" | "import" | "css";
};

function isExternal(value: string): boolean {
  return /^(?:https?:)?\/\//i.test(value);
}

export function findExternalAssets(html: string): ExternalAsset[] {
  const found: ExternalAsset[] = [];

  for (const match of html.matchAll(ATTRIBUTE_PATTERN)) {
    const value = match[1];
    if (value !== undefined && isExternal(value)) found.push({ url: value, kind: "attribute" });
  }

  for (const match of html.matchAll(IMPORT_PATTERN)) {
    const value = match[1];
    if (value !== undefined) found.push({ url: value, kind: "import" });
  }

  for (const match of html.matchAll(CSS_URL_PATTERN)) {
    const value = match[1];
    if (value !== undefined) found.push({ url: value, kind: "css" });
  }

  return found;
}
