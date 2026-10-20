import {
  failure,
  ok,
  systemClock,
  type AccountId,
  type Clock,
  type OAuthToken,
  type Result,
  type TokenStore,
} from "@cleamail/core";
import { isExpired } from "../credentials/token-codec.js";
import { refreshAccessToken, type ClientCredentials, type FetchLike } from "./oauth.js";

export interface AccessTokenProvider {
  token(): Promise<Result<string>>;
}

export type RefreshingTokenOptions = {
  readonly accountId: AccountId;
  readonly credentials: ClientCredentials;
  readonly tokens: TokenStore;
  readonly clock?: Clock;
  readonly fetchImpl?: FetchLike;
};

/**
 * Keeps a usable access token available, refreshing it from the keychain copy when it ages out.
 *
 * The refreshed token is written straight back, so the background service can run for weeks without
 * the user opening a browser again, and a revoked grant surfaces as `provider_auth` rather than as
 * a string of confusing 401s.
 */
export class RefreshingAccessTokenProvider implements AccessTokenProvider {
  private readonly clock: Clock;

  /** Last token seen, so a batch of requests does not read the keychain once per message. */
  private cached: OAuthToken | undefined;

  /** In-flight refresh, so concurrent requests trigger one refresh instead of one each. */
  private refreshing: Promise<Result<OAuthToken>> | undefined;

  constructor(private readonly options: RefreshingTokenOptions) {
    this.clock = options.clock ?? systemClock;
  }

  async token(): Promise<Result<string>> {
    const current = await this.current();
    if (!current.ok) return current;

    if (!isExpired(current.value, this.clock.now())) return ok(current.value.accessToken);

    const refreshToken = current.value.refreshToken;
    if (refreshToken === undefined) {
      return failure(
        "provider_auth",
        "The authorization expired. Run `cleamail init` to reconnect.",
      );
    }

    const refreshed = await this.refresh(refreshToken);
    if (!refreshed.ok) return refreshed;

    return ok(refreshed.value.accessToken);
  }

  private async current(): Promise<Result<OAuthToken>> {
    if (this.cached !== undefined) return ok(this.cached);

    const stored = await this.options.tokens.get(this.options.accountId);
    if (!stored.ok) return stored;

    if (stored.value === undefined) {
      return failure("provider_auth", "No account is connected yet. Run `cleamail init`.");
    }

    this.cached = stored.value;

    return ok(stored.value);
  }

  private refresh(refreshToken: string): Promise<Result<OAuthToken>> {
    this.refreshing ??= this.performRefresh(refreshToken).finally(() => {
      this.refreshing = undefined;
    });

    return this.refreshing;
  }

  private async performRefresh(refreshToken: string): Promise<Result<OAuthToken>> {
    const refreshed = await refreshAccessToken({
      ...this.options.credentials,
      refreshToken,
      ...(this.options.fetchImpl === undefined ? {} : { fetchImpl: this.options.fetchImpl }),
      now: this.clock.now(),
    });
    if (!refreshed.ok) return refreshed;

    const saved = await this.options.tokens.set(this.options.accountId, refreshed.value);
    if (!saved.ok) return saved;

    this.cached = refreshed.value;

    return refreshed;
  }
}

/** For tests and for a one-shot run with a token already in hand. */
export class StaticAccessTokenProvider implements AccessTokenProvider {
  constructor(private readonly value: string) {}

  token(): Promise<Result<string>> {
    return Promise.resolve(ok(this.value));
  }
}
