import { accountId, type OAuthToken } from "@cleamail/core";
import { describe, expect, it } from "vitest";
import { KeyringTokenStore, type KeyringEntry } from "./keyring-token-store.js";
import { InMemoryTokenStore } from "./memory-token-store.js";
import { isExpired, parseToken, serializeToken } from "./token-codec.js";

const ACCOUNT = accountId("user@example.com");

const token: OAuthToken = {
  accessToken: "at-1",
  refreshToken: "rt-1",
  expiresAt: new Date("2026-10-20T13:00:00.000Z"),
  scopes: ["https://www.googleapis.com/auth/gmail.modify"],
};

/** A keychain stand-in: the real one needs a desktop session, which CI does not have. */
class StubEntry implements KeyringEntry {
  constructor(
    private readonly slots: Map<string, string>,
    private readonly key: string,
  ) {}

  getPassword(): string | null {
    return this.slots.get(this.key) ?? null;
  }

  setPassword(password: string): void {
    this.slots.set(this.key, password);
  }

  deletePassword(): boolean {
    return this.slots.delete(this.key);
  }
}

describe("token codec", () => {
  it("round-trips a token", () => {
    const parsed = parseToken(serializeToken(token));

    expect(parsed).toStrictEqual({ ok: true, value: token });
  });

  it("omits absent fields rather than writing nulls", () => {
    expect(JSON.parse(serializeToken({ accessToken: "a", scopes: [] }))).toStrictEqual({
      accessToken: "a",
      scopes: [],
    });
  });

  it("asks for a reconnect when the stored credential is unreadable", () => {
    const parsed = parseToken("not json");

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.code).toBe("provider_auth");
    expect(parsed.error.message).toContain("Reconnect");
  });

  it("asks for a reconnect when the stored credential is incomplete", () => {
    expect(parseToken(JSON.stringify({ scopes: [] })).ok).toBe(false);
  });
});

describe("isExpired", () => {
  it("is false well before expiry", () => {
    expect(isExpired(token, new Date("2026-10-20T12:00:00.000Z"))).toBe(false);
  });

  it("is true inside the refresh skew", () => {
    expect(isExpired(token, new Date("2026-10-20T12:59:30.000Z"))).toBe(true);
  });

  it("treats a token with no expiry as usable", () => {
    expect(isExpired({ accessToken: "a", scopes: [] }, new Date())).toBe(false);
  });
});

describe("KeyringTokenStore", () => {
  const slots = new Map<string, string>();
  const store = new KeyringTokenStore(
    (service, account) => new StubEntry(slots, `${service}:${account}`),
  );

  it("starts empty", async () => {
    expect(await store.get(ACCOUNT)).toStrictEqual({ ok: true, value: undefined });
  });

  it("stores, reads back and deletes", async () => {
    expect(await store.set(ACCOUNT, token)).toStrictEqual({ ok: true, value: undefined });
    expect(await store.get(ACCOUNT)).toStrictEqual({ ok: true, value: token });

    await store.delete(ACCOUNT);
    expect(await store.get(ACCOUNT)).toStrictEqual({ ok: true, value: undefined });
  });

  it("reports a keychain failure without leaking the token", async () => {
    const failing = new KeyringTokenStore(() => ({
      getPassword: () => {
        throw new Error("keychain locked");
      },
      setPassword: () => undefined,
      deletePassword: () => true,
    }));

    const read = await failing.get(ACCOUNT);

    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.error.code).toBe("provider_auth");
    expect(read.error.message).not.toContain("at-1");
  });
});

describe("InMemoryTokenStore", () => {
  it("behaves like the keychain store for tests", async () => {
    const store = new InMemoryTokenStore();

    expect(await store.get(ACCOUNT)).toStrictEqual({ ok: true, value: undefined });
    await store.set(ACCOUNT, token);
    expect(await store.get(ACCOUNT)).toStrictEqual({ ok: true, value: token });
    await store.delete(ACCOUNT);
    expect(await store.get(ACCOUNT)).toStrictEqual({ ok: true, value: undefined });
  });
});
