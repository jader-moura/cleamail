/**
 * The privacy promise, written down.
 *
 * cleamail may talk to the user's own machine and to their mail provider. Nothing else. Adding a
 * host here is a deliberate act that should be hard to do by accident, which is the whole point of
 * this file: the tests in this package fail if code reaches a host that is not listed.
 */

/** The user's own machine. Ollama and the local dashboard live here. */
export const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "0.0.0.0"] as const;

/** Google, for Gmail only: authorization, token exchange and the Gmail API. */
export const GMAIL_HOSTS = [
  "accounts.google.com",
  "oauth2.googleapis.com",
  "gmail.googleapis.com",
] as const;

export const NETWORK_ALLOWED_HOSTS: readonly string[] = [...LOCAL_HOSTS, ...GMAIL_HOSTS];

/**
 * Hosts that may appear in source as text but are never contacted: links in help output, setup
 * instructions, OAuth scope identifiers and JSON schema ids.
 *
 * Keeping these separate is what makes the source scan useful. A new CDN, font or analytics URL
 * anywhere in the codebase lands in neither list and fails the test.
 */
export const MENTION_ONLY_HOSTS: readonly string[] = [
  // Printed for the user to visit themselves.
  "ollama.com",
  "console.cloud.google.com",
  "myaccount.google.com",
  "github.com",
  // Scope identifiers and schema ids. Never fetched.
  "www.googleapis.com",
  "mail.google.com",
  "json.schemastore.org",
  "turbo.build",
];

export function isNetworkAllowed(host: string, extra: readonly string[] = []): boolean {
  const normalized = normalizeHost(host);

  return (
    NETWORK_ALLOWED_HOSTS.includes(normalized) ||
    extra.map((candidate) => normalizeHost(candidate)).includes(normalized)
  );
}

/** Strips brackets from IPv6 literals and lowercases, so comparisons are stable. */
export function normalizeHost(host: string): string {
  return host.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
}

export function hostOf(target: string): string | undefined {
  try {
    return normalizeHost(new URL(target).hostname);
  } catch {
    return undefined;
  }
}
