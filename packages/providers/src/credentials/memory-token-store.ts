import { ok, type AccountId, type OAuthToken, type Result, type TokenStore } from "@cleamail/core";

/** For tests and for the eval runner, which never touches a real account. */
export class InMemoryTokenStore implements TokenStore {
  private readonly tokens = new Map<string, OAuthToken>();

  get(accountId: AccountId): Promise<Result<OAuthToken | undefined>> {
    return Promise.resolve(ok(this.tokens.get(accountId)));
  }

  set(accountId: AccountId, token: OAuthToken): Promise<Result<void>> {
    this.tokens.set(accountId, token);

    return Promise.resolve(ok(undefined));
  }

  delete(accountId: AccountId): Promise<Result<void>> {
    this.tokens.delete(accountId);

    return Promise.resolve(ok(undefined));
  }
}
