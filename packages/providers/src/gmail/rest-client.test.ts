import { accountId, fixedClock } from "@cleamail/core";
import { describe, expect, it } from "vitest";
import { InMemoryTokenStore } from "../credentials/memory-token-store.js";
import { RefreshingAccessTokenProvider, StaticAccessTokenProvider } from "./access-token.js";
import { GmailHttpError, GmailRestApi } from "./rest-client.js";

const ACCOUNT = accountId("user@example.com");
const NOW = new Date("2026-10-20T12:00:00.000Z");

/** Narrows what fetch accepts down to a string, which is all these tests send. */
function urlOf(url: unknown): string {
  if (typeof url === "string") return url;

  return url instanceof URL ? url.toString() : "";
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("GmailRestApi", () => {
  it("calls the Gmail API host with a bearer token", async () => {
    const seen: { url: string; auth: string | null } = { url: "", auth: null };

    const api = new GmailRestApi(new StaticAccessTokenProvider("at-1"), {
      fetchImpl: (url, init) => {
        seen.url = urlOf(url);
        seen.auth = new Headers(init?.headers).get("authorization");

        return Promise.resolve(jsonResponse({ emailAddress: "user@example.com" }));
      },
    });

    expect(await api.getProfile()).toStrictEqual({ emailAddress: "user@example.com" });
    expect(new URL(seen.url).host).toBe("gmail.googleapis.com");
    expect(seen.auth).toBe("Bearer at-1");
  });

  it("passes the search query and page token through", async () => {
    let requested = "";

    const api = new GmailRestApi(new StaticAccessTokenProvider("at-1"), {
      fetchImpl: (url) => {
        requested = urlOf(url);

        return Promise.resolve(jsonResponse({ messages: [{ id: "m1" }], nextPageToken: "p2" }));
      },
    });

    const page = await api.listMessages({
      query: "after:2026/10/01 -in:chats",
      maxResults: 50,
      pageToken: "p1",
    });

    const url = new URL(requested);
    expect(url.searchParams.get("q")).toBe("after:2026/10/01 -in:chats");
    expect(url.searchParams.get("maxResults")).toBe("50");
    expect(url.searchParams.get("pageToken")).toBe("p1");
    expect(page.nextPageToken).toBe("p2");
  });

  it("retries a rate limit and then succeeds", async () => {
    let attempts = 0;
    const waits: number[] = [];

    const api = new GmailRestApi(new StaticAccessTokenProvider("at-1"), {
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
      fetchImpl: () => {
        attempts += 1;

        return Promise.resolve(
          attempts < 3
            ? jsonResponse({ error: "rateLimitExceeded" }, 429)
            : jsonResponse({ emailAddress: "user@example.com" }),
        );
      },
    });

    await api.getProfile();

    expect(attempts).toBe(3);
    expect(waits).toStrictEqual([500, 1000]);
  });

  it("does not retry an auth failure", async () => {
    let attempts = 0;

    const api = new GmailRestApi(new StaticAccessTokenProvider("at-1"), {
      sleep: () => Promise.resolve(),
      fetchImpl: () => {
        attempts += 1;

        return Promise.resolve(jsonResponse({ error: "invalid_credentials" }, 401));
      },
    });

    await expect(api.getProfile()).rejects.toBeInstanceOf(GmailHttpError);
    expect(attempts).toBe(1);
  });

  it("gives up after the retry budget", async () => {
    let attempts = 0;

    const api = new GmailRestApi(new StaticAccessTokenProvider("at-1"), {
      maxRetries: 2,
      sleep: () => Promise.resolve(),
      fetchImpl: () => {
        attempts += 1;

        return Promise.resolve(jsonResponse({}, 503));
      },
    });

    await expect(api.getProfile()).rejects.toThrow(/503/);
    expect(attempts).toBe(3);
  });

  it("rejects a response that does not match the schema, without retrying it", async () => {
    let attempts = 0;

    const api = new GmailRestApi(new StaticAccessTokenProvider("at-1"), {
      sleep: () => Promise.resolve(),
      fetchImpl: () => {
        attempts += 1;

        return Promise.resolve(jsonResponse({ unexpected: true }));
      },
    });

    await expect(api.getProfile()).rejects.toThrow(/unexpected shape/);
    expect(attempts).toBe(1);
  });

  it("drops labels without a name instead of failing the list", async () => {
    const api = new GmailRestApi(new StaticAccessTokenProvider("at-1"), {
      fetchImpl: () =>
        Promise.resolve(
          jsonResponse({ labels: [{ id: "INBOX", name: "INBOX" }, { id: "Label_9" }] }),
        ),
    });

    expect(await api.listLabels()).toStrictEqual([{ id: "INBOX", name: "INBOX" }]);
  });
});

describe("RefreshingAccessTokenProvider", () => {
  it("asks the user to connect when there is no token", async () => {
    const provider = new RefreshingAccessTokenProvider({
      accountId: ACCOUNT,
      credentials: { clientId: "client-1" },
      tokens: new InMemoryTokenStore(),
      clock: fixedClock(NOW),
    });

    const token = await provider.token();

    expect(token.ok).toBe(false);
    if (token.ok) return;
    expect(token.error.code).toBe("provider_auth");
    expect(token.error.message).toContain("cleamail init");
  });

  it("uses a token that is still valid, without calling Google", async () => {
    const tokens = new InMemoryTokenStore();
    await tokens.set(ACCOUNT, {
      accessToken: "at-1",
      refreshToken: "rt-1",
      expiresAt: new Date(NOW.getTime() + 3_600_000),
      scopes: [],
    });

    const provider = new RefreshingAccessTokenProvider({
      accountId: ACCOUNT,
      credentials: { clientId: "client-1" },
      tokens,
      clock: fixedClock(NOW),
      fetchImpl: () => Promise.reject(new Error("should not be called")),
    });

    expect(await provider.token()).toStrictEqual({ ok: true, value: "at-1" });
  });

  it("refreshes an expired token and stores the new one", async () => {
    const tokens = new InMemoryTokenStore();
    await tokens.set(ACCOUNT, {
      accessToken: "at-old",
      refreshToken: "rt-1",
      expiresAt: new Date(NOW.getTime() - 1000),
      scopes: [],
    });

    const provider = new RefreshingAccessTokenProvider({
      accountId: ACCOUNT,
      credentials: { clientId: "client-1" },
      tokens,
      clock: fixedClock(NOW),
      fetchImpl: () => Promise.resolve(jsonResponse({ access_token: "at-new", expires_in: 3600 })),
    });

    expect(await provider.token()).toStrictEqual({ ok: true, value: "at-new" });

    const stored = await tokens.get(ACCOUNT);
    expect(stored.ok && stored.value?.accessToken).toBe("at-new");
    expect(stored.ok && stored.value?.refreshToken).toBe("rt-1");
  });

  it("asks for a reconnect when there is nothing to refresh with", async () => {
    const tokens = new InMemoryTokenStore();
    await tokens.set(ACCOUNT, {
      accessToken: "at-old",
      expiresAt: new Date(NOW.getTime() - 1000),
      scopes: [],
    });

    const provider = new RefreshingAccessTokenProvider({
      accountId: ACCOUNT,
      credentials: { clientId: "client-1" },
      tokens,
      clock: fixedClock(NOW),
    });

    const token = await provider.token();

    expect(token.ok).toBe(false);
    if (token.ok) return;
    expect(token.error.message).toContain("reconnect");
  });
});
