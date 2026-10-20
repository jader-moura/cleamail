/**
 * Decodes RFC 2047 encoded words, the `=?UTF-8?B?...?=` form that shows up in `Subject` and in
 * display names.
 *
 * Without this, a non-ASCII subject reaches the classifier as mojibake and the user sees it that
 * way in the dashboard. Anything that does not decode is left exactly as it arrived: this is
 * untrusted input, and dropping it would be worse than showing it raw.
 */

const ENCODED_WORD = /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g;

function decodeQuotedPrintable(input: string, charset: string): string {
  const bytes: number[] = [];

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (char === "_") {
      bytes.push(0x20);
      continue;
    }

    if (char === "=" && index + 2 < input.length) {
      const hex = input.slice(index + 1, index + 3);
      const byte = Number.parseInt(hex, 16);

      if (!Number.isNaN(byte)) {
        bytes.push(byte);
        index += 2;
        continue;
      }
    }

    bytes.push(char?.charCodeAt(0) ?? 0);
  }

  return decodeBytes(Buffer.from(bytes), charset);
}

function decodeBytes(buffer: Buffer, charset: string): string {
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return buffer.toString("utf8");
  }
}

export function decodeEncodedWords(value: string): string {
  if (!value.includes("=?")) return value;

  return value.replaceAll(ENCODED_WORD, (match, rawCharset: string, encoding: string, text) => {
    const charset = rawCharset.split("*")[0]?.toLowerCase() ?? "utf-8";
    const payload = typeof text === "string" ? text : "";

    if (encoding.toLowerCase() === "b") {
      try {
        return decodeBytes(Buffer.from(payload, "base64"), charset);
      } catch {
        return match;
      }
    }

    return decodeQuotedPrintable(payload, charset);
  });
}
