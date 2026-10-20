import { accountId, emailId } from "@cleamail/core";
import {
  buildAuthorizationUrl,
  createPkcePair,
  createState,
  exchangeAuthorizationCode,
  GmailProvider,
  GmailRestApi,
  InMemoryTokenStore,
  LABEL_CLEANED_FOR_TEST,
  RefreshingAccessTokenProvider,
  StaticAccessTokenProvider,
} from "./test/providers.js";
import { afterEach, describe, expect, it } from "vitest";
import { installNetworkGuard, type NetworkGuard } from "./guard.js";

/**
 * The real Gmail client, the real OAuth exchange and the real token refresh, all under the guard.
 *
 * This is the test that actually defends the privacy promise: it does not inspect code, it runs it
 * and records every host the code tried to reach. If any of these paths ever gains a call to a
 * third party, this fails.
 */

const ACCOUNT = accountId("user@example.com");

function respond(url: string): Response {
  const body = url.includes("/profile")
    ? { emailAddress: "user@example.com" }
    : url.includes("/labels")
      ? { labels: [{ id: "INBOX", name: "INBOX" }] }
      : url.includes("/messages/")
        ? {
            id: "m1",
            threadId: "t1",
            labelIds: ["INBOX"],
            snippet: "hi",
            internalDate: "1791187200000",
            payload: {
              mimeType: "text/plain",
              filename: "",
              headers: [{ name: "From", value: "a@b.c" }],
              body: { data: Buffer.from("hello", "utf8").toString("base64url") },
            },
          }
        : url.includes("/messages")
          ? { messages: [{ id: "m1", threadId: "t1" }] }
          : url.includes("oauth2.googleapis.com")
            ? { access_token: "at-1", refresh_token: "rt-1", expires_in: 3600 }
            : {};

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("the real pipeline under the privacy guard", () => {
  let guard: NetworkGuard | undefined;

  afterEach(() => {
    guard?.restore();
    guard = undefined;
  });

  it("fetches and applies actions without reaching anything but Gmail", async () => {
    guard = installNetworkGuard({ respond: (url) => respond(url) });

    const api = new GmailRestApi(new StaticAccessTokenProvider("at-1"));
    const provider = new GmailProvider(api);

    const page = await provider.listEmails({ since: new Date("2026-10-01T00:00:00.000Z") });
    expect(page.ok).toBe(true);

    await provider.applyActions(emailId("m1"), [
      { type: "label", label: LABEL_CLEANED_FOR_TEST, hadLabel: false },
      { type: "archive", wasInInbox: true },
    ]);
    await provider.ensureLabels([LABEL_CLEANED_FOR_TEST]);

    expect(guard.attempts.length).toBeGreaterThan(3);
    expect(guard.violations).toStrictEqual([]);
    expect([...new Set(guard.attempts.map((attempt) => attempt.host))]).toStrictEqual([
      "gmail.googleapis.com",
    ]);
  });

  it("exchanges and refreshes a token only with Google's token endpoint", async () => {
    guard = installNetworkGuard({ respond: (url) => respond(url) });

    const pkce = createPkcePair();
    const exchanged = await exchangeAuthorizationCode({
      clientId: "client-1",
      code: "code-1",
      codeVerifier: pkce.verifier,
      redirectUri: "http://127.0.0.1:1234/callback",
    });
    expect(exchanged.ok).toBe(true);

    const tokens = new InMemoryTokenStore();
    await tokens.set(ACCOUNT, {
      accessToken: "at-old",
      refreshToken: "rt-1",
      expiresAt: new Date(Date.now() - 1000),
      scopes: [],
    });

    const refreshed = await new RefreshingAccessTokenProvider({
      accountId: ACCOUNT,
      credentials: { clientId: "client-1" },
      tokens,
    }).token();
    expect(refreshed.ok).toBe(true);

    expect(guard.violations).toStrictEqual([]);
    expect([...new Set(guard.attempts.map((attempt) => attempt.host))]).toStrictEqual([
      "oauth2.googleapis.com",
    ]);
  });

  it("sends the user to Google's own authorization page", () => {
    const url = buildAuthorizationUrl({
      clientId: "client-1",
      redirectUri: "http://127.0.0.1:1234/callback",
      state: createState(),
      codeChallenge: createPkcePair().challenge,
    });

    expect(new URL(url).hostname).toBe("accounts.google.com");
  });

  it("would fail loudly if the pipeline ever called a third party", async () => {
    guard = installNetworkGuard({ respond: (url) => respond(url) });

    await expect(
      // Stands in for a dependency or a future change phoning home.
      fetch("https://metrics.cleamail.example/v1/events", { method: "POST" }),
    ).rejects.toThrow(/Blocked an outbound request/);

    expect(guard.violations.map((attempt) => attempt.host)).toStrictEqual([
      "metrics.cleamail.example",
    ]);
  });
});
