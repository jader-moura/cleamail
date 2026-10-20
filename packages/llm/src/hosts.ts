import { failure, ok, type Result } from "@cleamail/core";

/**
 * Ollama, on the user's own machine.
 *
 * The second promise says email content never leaves the machine, and this package is the only one
 * that sends email content anywhere at all. So the base URL is checked rather than trusted: a
 * configured host that is not loopback is refused before a request is built, not after.
 */
export const OLLAMA_DEFAULT_URL = "http://localhost:11434";

/** Hostnames that mean "this machine". Matches the privacy package's `LOCAL_HOSTS`. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

export function isLoopbackUrl(candidate: string): boolean {
  try {
    const host = new URL(candidate).hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();

    return LOOPBACK_HOSTS.has(host);
  } catch {
    return false;
  }
}

/**
 * Validates a configured Ollama URL and strips any trailing slash, so callers can append paths
 * without producing a double slash.
 */
export function resolveOllamaUrl(candidate: string = OLLAMA_DEFAULT_URL): Result<string> {
  if (!isLoopbackUrl(candidate)) {
    return failure(
      "config_invalid",
      `Ollama must run on this machine. "${candidate}" is not a loopback address, and cleamail will not send email content to it.`,
    );
  }

  return ok(candidate.replace(/\/+$/, ""));
}
