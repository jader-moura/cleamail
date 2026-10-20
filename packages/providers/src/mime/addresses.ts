import type { EmailAddress } from "@cleamail/core";
import { decodeEncodedWords } from "./rfc2047.js";

/**
 * Parses an address header into domain addresses.
 *
 * This is a pragmatic parser, not a full RFC 5322 implementation: it handles the forms real mail
 * actually uses (`a@b.c`, `Name <a@b.c>`, `"Last, First" <a@b.c>`, groups separated by commas or
 * semicolons) and never throws. A header it cannot make sense of yields no addresses rather than a
 * failure, because an odd `Cc` must not stop a message from being classified.
 */
export function parseAddressList(header: string | undefined): EmailAddress[] {
  if (header === undefined || header.trim() === "") return [];

  return splitAddresses(header)
    .map((entry) => parseAddress(entry))
    .filter((address): address is EmailAddress => address !== undefined);
}

export function parseAddress(entry: string): EmailAddress | undefined {
  const trimmed = entry.trim();
  if (trimmed === "") return undefined;

  const angleStart = trimmed.lastIndexOf("<");
  const angleEnd = trimmed.lastIndexOf(">");

  if (angleStart !== -1 && angleEnd > angleStart) {
    const address = trimmed.slice(angleStart + 1, angleEnd).trim();
    if (address === "") return undefined;

    const name = cleanName(trimmed.slice(0, angleStart));

    return name === undefined ? { address } : { address, name };
  }

  // A bare address, possibly with a trailing comment such as `a@b.c (Support)`.
  const bare = trimmed.split(/\s+/)[0] ?? "";
  return bare === "" ? undefined : { address: bare };
}

function cleanName(raw: string): string | undefined {
  const decoded = decodeEncodedWords(raw).trim();
  const unquoted =
    decoded.startsWith('"') && decoded.endsWith('"') ? decoded.slice(1, -1) : decoded;
  const name = unquoted.trim();

  return name === "" ? undefined : name;
}

/** Splits on separators that are not inside a quoted string or angle brackets. */
function splitAddresses(header: string): string[] {
  const entries: string[] = [];
  let current = "";
  let inQuotes = false;
  let inAngles = false;

  for (const char of header) {
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }

    if (!inQuotes && char === "<") inAngles = true;
    if (!inQuotes && char === ">") inAngles = false;

    if (!inQuotes && !inAngles && (char === "," || char === ";")) {
      entries.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  entries.push(current);

  return entries.filter((entry) => entry.trim() !== "");
}
