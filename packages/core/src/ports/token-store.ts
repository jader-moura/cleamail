import type { AccountId } from "../domain/ids.js";
import type { Result } from "../result.js";

export type OAuthToken = {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresAt?: Date;
  readonly scopes: readonly string[];
};

/**
 * Credentials live in the OS keychain, never in a file in the repo or in a log line. This port
 * exists so nothing outside the adapter that owns it can read a token by accident.
 */
export interface TokenStore {
  get(accountId: AccountId): Promise<Result<OAuthToken | undefined>>;

  set(accountId: AccountId, token: OAuthToken): Promise<Result<void>>;

  delete(accountId: AccountId): Promise<Result<void>>;
}
