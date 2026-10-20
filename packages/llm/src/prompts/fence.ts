/**
 * Putting untrusted text into a prompt safely.
 *
 * Every byte of an email is attacker-controlled. Fencing it is only worth something if the fence
 * cannot be forged, so this module is the one place that builds the fence, and it strips anything in
 * the content that could imitate either the fence or the chat template around it.
 */

export const FENCE_BEGIN = "-----BEGIN UNTRUSTED EMAIL-----";
export const FENCE_END = "-----END UNTRUSTED EMAIL-----";

/** Our own markers, however the sender spaces or lengthens the dashes. */
const MARKER_PATTERN = /-{3,}\s*(?:BEGIN|END)\s+UNTRUSTED\s+EMAIL\s*-{3,}/gi;

/**
 * Chat-template control tokens. Qwen and most open models use ChatML, where `<|im_start|>system`
 * begins a new turn. An email containing one of these is trying to stop being data, so the tokens
 * are removed rather than escaped.
 */
const CONTROL_TOKEN_PATTERN = /<\|[^|>]{0,64}\|>/g;

const REDACTED = "[removed]";

/** How much of a body the model sees. Enough for any real decision, and a bounded prompt. */
export const MAX_BODY_CHARS = 4000;
export const MAX_SUBJECT_CHARS = 300;
export const MAX_FIELD_CHARS = 200;

/**
 * Makes a single untrusted string safe to place inside the fence.
 *
 * Normalises line endings so a lone `\r` cannot hide a marker from the pattern above, drops
 * control tokens and fence markers, and strips the C0 control characters that could otherwise be
 * used to confuse a terminal when the same text is printed in the dry-run report.
 */
export function neutralize(text: string): string {
  return (
    text
      .replace(/\r\n?/g, "\n")
      // The control characters are the point of this line, so the rule that normally catches them
      // by accident is off for it. Everything except tab and newline becomes a space.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
      .replace(CONTROL_TOKEN_PATTERN, REDACTED)
      .replace(MARKER_PATTERN, REDACTED)
  );
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;

  return `${text.slice(0, max)}\n[truncated after ${String(max)} characters]`;
}

/** Neutralises, truncates and trims a single untrusted field. */
export function safeField(text: string, max: number = MAX_FIELD_CHARS): string {
  return truncate(neutralize(text).trim(), max);
}

/** Wraps already-neutralised content in the fence. */
export function fence(content: string): string {
  return `${FENCE_BEGIN}\n${content}\n${FENCE_END}`;
}
