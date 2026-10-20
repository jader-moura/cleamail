import { failure, ok, type OAuthToken, type Result } from "@cleamail/core";
import { z } from "zod";

/**
 * Tokens are stored as JSON in the OS keychain, so they get parsed back as external input: a
 * keychain entry written by an older version must not crash a run or, worse, be used half-read.
 */
const StoredTokenSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).optional(),
  expiresAt: z.coerce.date().optional(),
  scopes: z.array(z.string()).default([]),
});

export function serializeToken(token: OAuthToken): string {
  return JSON.stringify({
    accessToken: token.accessToken,
    ...(token.refreshToken === undefined ? {} : { refreshToken: token.refreshToken }),
    ...(token.expiresAt === undefined ? {} : { expiresAt: token.expiresAt.toISOString() }),
    scopes: token.scopes,
  });
}

export function parseToken(serialized: string): Result<OAuthToken> {
  let json: unknown;

  try {
    json = JSON.parse(serialized);
  } catch {
    return failure("provider_auth", "The stored credential is not readable. Reconnect to fix it.");
  }

  const parsed = StoredTokenSchema.safeParse(json);
  if (!parsed.success) {
    return failure("provider_auth", "The stored credential is incomplete. Reconnect to fix it.");
  }

  const { accessToken, refreshToken, expiresAt, scopes } = parsed.data;

  return ok({
    accessToken,
    ...(refreshToken === undefined ? {} : { refreshToken }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    scopes,
  });
}

/** True when the token is expired or close enough that a refresh is worth doing now. */
export function isExpired(token: OAuthToken, now: Date, skewSeconds = 60): boolean {
  if (token.expiresAt === undefined) return false;

  return token.expiresAt.getTime() - skewSeconds * 1000 <= now.getTime();
}
