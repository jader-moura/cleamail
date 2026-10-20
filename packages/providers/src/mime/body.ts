import { convert } from "html-to-text";

/** One decoded leaf of a MIME tree. Providers flatten their own payload shape into these. */
export type TextPart = {
  readonly mimeType: string;
  /** Non-empty for attachments, which never contribute to the body. */
  readonly filename: string;
  readonly text: string;
};

/**
 * Bodies longer than this add nothing a classifier can use and only bloat the local database and
 * the prompt. The cut is logged nowhere and shown nowhere: it only affects what the model reads.
 */
export const MAX_BODY_CHARS = 20_000;

/** Collapses runs of whitespace and blank lines, which is most of a marketing email. */
export function normalizeText(text: string): string {
  return text
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll(/[ \t]+/g, " ")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();
}

export function htmlToText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: "img", format: "skip" },
      // Link targets are noise for classification and one more place for injected text to hide.
      { selector: "a", options: { ignoreHref: true } },
    ],
  });
}

/**
 * Picks the body a human would read: plain text if the sender provided it, otherwise the HTML
 * alternative converted to text. Attachments are ignored entirely.
 */
export function selectBodyText(parts: readonly TextPart[]): string {
  const usable = parts.filter((part) => part.filename === "" && part.text !== "");

  const plain = usable
    .filter((part) => part.mimeType.startsWith("text/plain"))
    .map((part) => part.text)
    .join("\n\n");

  if (plain.trim() !== "") return truncate(normalizeText(plain));

  const html = usable
    .filter((part) => part.mimeType.startsWith("text/html"))
    .map((part) => htmlToText(part.text))
    .join("\n\n");

  return truncate(normalizeText(html));
}

function truncate(text: string): string {
  return text.length <= MAX_BODY_CHARS ? text : `${text.slice(0, MAX_BODY_CHARS)}\n[truncated]`;
}
