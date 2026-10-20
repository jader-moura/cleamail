import { domainError, type DomainError, type ErrorCode } from "@cleamail/core";

/**
 * Maps a thrown API failure onto a domain error code.
 *
 * The distinction matters to the caller: `provider_auth` means stop and ask the user to reconnect,
 * `provider_rate_limited` means back off and try later, and anything else means this run failed but
 * the inbox is untouched.
 */
function statusOf(cause: unknown): number | undefined {
  if (typeof cause !== "object" || cause === null) return undefined;

  const record: Record<string, unknown> = { ...cause };
  const candidates = [record["status"], record["code"], record["statusCode"]];

  for (const candidate of candidates) {
    if (typeof candidate === "number") return candidate;
    if (typeof candidate === "string") {
      const parsed = Number.parseInt(candidate, 10);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }

  return undefined;
}

export function codeForStatus(status: number | undefined): ErrorCode {
  if (status === 401 || status === 403) return "provider_auth";
  if (status === 404) return "not_found";
  if (status === 429) return "provider_rate_limited";
  if (status !== undefined && status >= 500) return "provider_unavailable";

  return "provider_unavailable";
}

export function toDomainError(cause: unknown, message: string): DomainError {
  return domainError(codeForStatus(statusOf(cause)), message, cause);
}

/** Whether a failure is worth retrying after a wait. */
export function isRetryable(cause: unknown): boolean {
  const status = statusOf(cause);

  return status === 429 || (status !== undefined && status >= 500);
}
