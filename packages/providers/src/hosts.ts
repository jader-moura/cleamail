/**
 * Every host cleamail is allowed to talk to for Gmail, in one place.
 *
 * The privacy promise is only as good as this list: SPEC-006 asserts that no code path reaches a
 * host outside it, and the list exists here so that test has something to check against rather than
 * a string buried in a request.
 */
export const GOOGLE_AUTH_HOST = "accounts.google.com";
export const GOOGLE_TOKEN_HOST = "oauth2.googleapis.com";
export const GMAIL_API_HOST = "gmail.googleapis.com";

export const GOOGLE_AUTH_URL = `https://${GOOGLE_AUTH_HOST}/o/oauth2/v2/auth`;
export const GOOGLE_TOKEN_URL = `https://${GOOGLE_TOKEN_HOST}/token`;
export const GMAIL_API_BASE = `https://${GMAIL_API_HOST}/gmail/v1/users/me`;

export const GMAIL_ALLOWED_HOSTS = [GOOGLE_AUTH_HOST, GOOGLE_TOKEN_HOST, GMAIL_API_HOST] as const;
