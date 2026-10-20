/**
 * The OAuth scopes cleamail asks for: exactly one.
 *
 * `gmail.modify` can read messages and change labels, which is everything the policy engine needs,
 * including moving to Trash. It cannot send, and cannot permanently delete (that needs
 * `mail.google.com`). Nothing in this project may add a scope to this list without the user asking
 * for a feature that cannot work otherwise.
 */
export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.modify"] as const;

/** Scopes that must never appear, kept explicit so the test reads as documentation. */
export const FORBIDDEN_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.settings.basic",
  "https://mail.google.com/",
] as const;

export function scopeString(): string {
  return GMAIL_SCOPES.join(" ");
}
