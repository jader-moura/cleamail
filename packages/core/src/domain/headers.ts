import { z } from "zod";

/**
 * Headers are kept as a flat record with lowercase keys and joined values. The rules layer can then
 * ask for `list-unsubscribe` without knowing whether the message came from Gmail or IMAP.
 *
 * Header values are attacker-controlled: they are data to match on, never instructions.
 */
export const HeadersSchema = z.record(z.string(), z.string());
export type Headers = z.infer<typeof HeadersSchema>;

export type RawHeader = { readonly name: string; readonly value: string };

/**
 * Lowercases names, trims values and joins repeated headers with ", " (the folding RFC 5322 allows
 * for comma-separated lists, which is what repeated `List-Unsubscribe` entries look like).
 */
export function normalizeHeaders(raw: readonly RawHeader[]): Headers {
  const headers: Record<string, string> = {};

  for (const { name, value } of raw) {
    const key = name.trim().toLowerCase();
    if (key === "") continue;

    const next = value.trim();
    const existing = headers[key];
    headers[key] = existing === undefined ? next : `${existing}, ${next}`;
  }

  return headers;
}

export function getHeader(headers: Headers, name: string): string | undefined {
  return headers[name.toLowerCase()];
}

export function hasHeader(headers: Headers, name: string): boolean {
  return getHeader(headers, name) !== undefined;
}
