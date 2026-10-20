import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildAuthorizationUrl,
  createPkcePair,
  createState,
  exchangeAuthorizationCode,
  hasOnlyAllowedScopes,
  refreshAccessToken,
  startLoopbackReceiver,
} from "./oauth.js";
import { FORBIDDEN_SCOPES, GMAIL_SCOPES, scopeString } from "./scopes.js";

const NOW = new Date("2026-10-20T12:00:00.000Z");

function urlOf(url: unknown): string {
  if (typeof url === "string") return url;

  return url instanceof URL ? url.toString() : "";
}

function bodyOf(init: RequestInit | undefined): string {
  return typeof init?.body === "string" ? init.body : "";
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("scopes", () => {
  it("asks for gmail.modify and nothing else", () => {
    expect(GMAIL_SCOPES).toStrictEqual(["https://www.googleapis.com/auth/gmail.modify"]);
  });

  it("never asks for send, compose, settings or full mail access", () => {
    for (const forbidden of FORBIDDEN_SCOPES) {
      expect(scopeString()).not.toContain(forbidden);
    }
  });
});

describe("createPkcePair", () => {
  it("derives the challenge as the S256 hash of the verifier", () => {
    const { verifier, challenge } = createPkcePair();

    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });

  it("is different every time", () => {
    expect(createPkcePair().verifier).not.toBe(createPkcePair().verifier);
    expect(createState()).not.toBe(createState());
  });
});

describe("buildAuthorizationUrl", () => {
  const url = new URL(
    buildAuthorizationUrl({
      clientId: "client-1",
      redirectUri: "http://127.0.0.1:1234/callback",
      state: "state-1",
      codeChallenge: "challenge-1",
      loginHint: "user@example.com",
    }),
  );

  it("points at Google's authorization endpoint and nowhere else", () => {
    expect(url.host).toBe("accounts.google.com");
  });

  it("uses PKCE with S256", () => {
    expect(url.searchParams.get("code_challenge")).toBe("challenge-1");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("asks for offline access, so the background service does not need a browser", () => {
    expect(url.searchParams.get("access_type")).toBe("offline");
  });

  it("requests only the gmail.modify scope", () => {
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/gmail.modify");
  });

  it("redirects to loopback", () => {
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:1234/callback");
  });
});

describe("exchangeAuthorizationCode", () => {
  it("sends the verifier and returns a token with an absolute expiry", async () => {
    let sentBody = "";

    const token = await exchangeAuthorizationCode({
      clientId: "client-1",
      code: "code-1",
      codeVerifier: "verifier-1",
      redirectUri: "http://127.0.0.1:1234/callback",
      now: NOW,
      fetchImpl: (url, init) => {
        expect(urlOf(url)).toBe("https://oauth2.googleapis.com/token");
        sentBody = bodyOf(init);

        return Promise.resolve(
          jsonResponse({
            access_token: "at-1",
            refresh_token: "rt-1",
            expires_in: 3600,
            scope: "https://www.googleapis.com/auth/gmail.modify",
          }),
        );
      },
    });

    expect(sentBody).toContain("code_verifier=verifier-1");
    expect(sentBody).toContain("grant_type=authorization_code");

    expect(token.ok).toBe(true);
    if (!token.ok) return;
    expect(token.value.accessToken).toBe("at-1");
    expect(token.value.refreshToken).toBe("rt-1");
    expect(token.value.expiresAt).toStrictEqual(new Date(NOW.getTime() + 3_600_000));
    expect(token.value.scopes).toStrictEqual(["https://www.googleapis.com/auth/gmail.modify"]);
  });

  it("reports a rejection as provider_auth without echoing the response body", async () => {
    const token = await exchangeAuthorizationCode({
      clientId: "client-1",
      code: "bad",
      codeVerifier: "v",
      redirectUri: "http://127.0.0.1:1/callback",
      fetchImpl: () => Promise.resolve(jsonResponse({ error: "invalid_grant" }, 400)),
    });

    expect(token.ok).toBe(false);
    if (token.ok) return;
    expect(token.error.code).toBe("provider_auth");
    expect(token.error.message).not.toContain("invalid_grant");
  });

  it("reports an unreachable network as provider_unavailable", async () => {
    const token = await exchangeAuthorizationCode({
      clientId: "client-1",
      code: "c",
      codeVerifier: "v",
      redirectUri: "http://127.0.0.1:1/callback",
      fetchImpl: () => Promise.reject(new Error("offline")),
    });

    expect(token.ok && false).toBe(false);
    if (token.ok) return;
    expect(token.error.code).toBe("provider_unavailable");
  });
});

describe("refreshAccessToken", () => {
  it("keeps the existing refresh token when Google does not return a new one", async () => {
    const token = await refreshAccessToken({
      clientId: "client-1",
      refreshToken: "rt-1",
      now: NOW,
      fetchImpl: (_url, init) => {
        expect(bodyOf(init)).toContain("grant_type=refresh_token");

        return Promise.resolve(jsonResponse({ access_token: "at-2", expires_in: 1800 }));
      },
    });

    expect(token.ok && token.value.refreshToken).toBe("rt-1");
    expect(token.ok && token.value.accessToken).toBe("at-2");
  });
});

describe("hasOnlyAllowedScopes", () => {
  it("accepts the scope cleamail asks for", () => {
    const token = { accessToken: "a", scopes: [...GMAIL_SCOPES] };

    expect(hasOnlyAllowedScopes(token, FORBIDDEN_SCOPES)).toStrictEqual({
      ok: true,
      value: undefined,
    });
  });

  it("refuses a grant that came back with send access", () => {
    const token = {
      accessToken: "a",
      scopes: [...GMAIL_SCOPES, "https://www.googleapis.com/auth/gmail.send"],
    };

    const checked = hasOnlyAllowedScopes(token, FORBIDDEN_SCOPES);

    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(checked.error.code).toBe("provider_auth");
    expect(checked.error.message).toContain("gmail.send");
  });
});

describe("startLoopbackReceiver", () => {
  it("binds loopback only and completes with the code", async () => {
    const receiver = await startLoopbackReceiver();

    try {
      expect(receiver.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);

      const pending = receiver.waitForCode("state-1", 5_000);
      const response = await fetch(`${receiver.redirectUri}?code=code-1&state=state-1`);

      expect(response.status).toBe(200);
      expect(await pending).toStrictEqual({ ok: true, value: "code-1" });
    } finally {
      receiver.close();
    }
  });

  it("refuses a callback whose state does not match", async () => {
    const receiver = await startLoopbackReceiver();

    try {
      const pending = receiver.waitForCode("state-1", 5_000);
      const response = await fetch(`${receiver.redirectUri}?code=code-1&state=someone-else`);

      expect(response.status).toBe(400);

      const result = await pending;
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("provider_auth");
    } finally {
      receiver.close();
    }
  });

  it("reports a declined authorization", async () => {
    const receiver = await startLoopbackReceiver();

    try {
      const pending = receiver.waitForCode("state-1", 5_000);
      await fetch(`${receiver.redirectUri}?error=access_denied&state=state-1`);

      const result = await pending;
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain("access_denied");
    } finally {
      receiver.close();
    }
  });

  it("gives up after the timeout instead of waiting forever", async () => {
    const receiver = await startLoopbackReceiver();

    try {
      const result = await receiver.waitForCode("state-1", 10);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain("timed out");
    } finally {
      receiver.close();
    }
  });
});
