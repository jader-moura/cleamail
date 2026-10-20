import { accountId, fixedClock } from "@cleamail/core";
import { describe, expect, it } from "vitest";
import { InMemoryTokenStore } from "../credentials/memory-token-store.js";
import { RefreshingAccessTokenProvider } from "./access-token.js";

const ACCOUNT = accountId("user@example.com");
const NOW = new Date("2026-10-20T12:00:00.000Z");

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("RefreshingAccessTokenProvider caching", () => {
  it("refreshes once for a batch of concurrent requests", async () => {
    const tokens = new InMemoryTokenStore();
    await tokens.set(ACCOUNT, {
      accessToken: "at-old",
      refreshToken: "rt-1",
      expiresAt: new Date(NOW.getTime() - 1000),
      scopes: [],
    });

    let refreshes = 0;

    const provider = new RefreshingAccessTokenProvider({
      accountId: ACCOUNT,
      credentials: { clientId: "client-1" },
      tokens,
      clock: fixedClock(NOW),
      fetchImpl: () => {
        refreshes += 1;

        return Promise.resolve(jsonResponse({ access_token: "at-new", expires_in: 3600 }));
      },
    });

    const results = await Promise.all([
      provider.token(),
      provider.token(),
      provider.token(),
      provider.token(),
      provider.token(),
    ]);

    expect(results.every((result) => result.ok && result.value === "at-new")).toBe(true);
    expect(refreshes).toBe(1);
  });

  it("reads the keychain once, not once per request", async () => {
    const inner = new InMemoryTokenStore();
    await inner.set(ACCOUNT, {
      accessToken: "at-1",
      refreshToken: "rt-1",
      expiresAt: new Date(NOW.getTime() + 3_600_000),
      scopes: [],
    });

    let reads = 0;
    const counting = {
      get: (id: typeof ACCOUNT) => {
        reads += 1;

        return inner.get(id);
      },
      set: inner.set.bind(inner),
      delete: inner.delete.bind(inner),
    };

    const provider = new RefreshingAccessTokenProvider({
      accountId: ACCOUNT,
      credentials: { clientId: "client-1" },
      tokens: counting,
      clock: fixedClock(NOW),
    });

    await provider.token();
    await provider.token();
    await provider.token();

    expect(reads).toBe(1);
  });

  it("uses the refreshed token for later requests without refreshing again", async () => {
    const tokens = new InMemoryTokenStore();
    await tokens.set(ACCOUNT, {
      accessToken: "at-old",
      refreshToken: "rt-1",
      expiresAt: new Date(NOW.getTime() - 1000),
      scopes: [],
    });

    let refreshes = 0;

    const provider = new RefreshingAccessTokenProvider({
      accountId: ACCOUNT,
      credentials: { clientId: "client-1" },
      tokens,
      clock: fixedClock(NOW),
      fetchImpl: () => {
        refreshes += 1;

        return Promise.resolve(jsonResponse({ access_token: "at-new", expires_in: 3600 }));
      },
    });

    expect(await provider.token()).toStrictEqual({ ok: true, value: "at-new" });
    expect(await provider.token()).toStrictEqual({ ok: true, value: "at-new" });
    expect(refreshes).toBe(1);
  });
});
