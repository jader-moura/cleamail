/**
 * The OAuth scopes cleamail asks for: exactly one, and never more than needed.
 *
 * `gmail.modify` can read messages and change labels, which is everything the policy engine needs,
 * including moving to Trash. It cannot send, and cannot permanently delete (that needs
 * `mail.google.com`). Nothing in this project may add a scope to this list without the user asking
 * for a feature that cannot work otherwise.
 */
export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.modify"] as const;

/**
 * Read-only access, for trying cleamail against a real mailbox before trusting it with anything.
 *
 * This is the stronger promise of the two: with `gmail.readonly`, Google refuses any modification
 * itself, so no bug, no future spec and no misread setting can change a mailbox authorized this
 * way. The classify phase needs nothing more, since it only reads and reports. Acting on a decision
 * (SPEC-011) requires re-authorizing with `GMAIL_SCOPES`.
 */
export const GMAIL_READONLY_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"] as const;

/** Scopes that must never appear, kept explicit so the test reads as documentation. */
export const FORBIDDEN_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.settings.basic",
  "https://mail.google.com/",
] as const;

/** How much access an authorization carries. */
export type GmailAccess = "modify" | "readonly";

export function scopesFor(access: GmailAccess): readonly string[] {
  return access === "readonly" ? GMAIL_READONLY_SCOPES : GMAIL_SCOPES;
}

export function scopeString(access: GmailAccess = "modify"): string {
  return scopesFor(access).join(" ");
}

/**
 * Reads the access level back off a stored token.
 *
 * Anything that is not the modify scope is treated as read-only, which is the safe direction to be
 * wrong in: a token we cannot interpret will be assumed unable to act, so SPEC-011 refuses rather
 * than tries.
 */
export function accessOfScopes(scopes: readonly string[]): GmailAccess {
  return scopes.includes(GMAIL_SCOPES[0]) ? "modify" : "readonly";
}

/** Whether a stored token is allowed to change anything in the mailbox. */
export function canModify(scopes: readonly string[]): boolean {
  return accessOfScopes(scopes) === "modify";
}
