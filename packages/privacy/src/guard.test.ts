import dns from "node:dns";
import https from "node:https";
import { afterEach, describe, expect, it } from "vitest";
import {
  installNetworkGuard,
  LiveConnectionError,
  PrivacyViolationError,
  type NetworkGuard,
} from "./guard.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("installNetworkGuard", () => {
  let guard: NetworkGuard | undefined;

  afterEach(() => {
    guard?.restore();
    guard = undefined;
  });

  it("answers an allowed host from the canned responder", async () => {
    guard = installNetworkGuard({ respond: () => jsonResponse({ ok: true }) });

    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile");

    expect(response.status).toBe(200);
    expect(guard.violations).toStrictEqual([]);
    expect(guard.attempts[0]?.host).toBe("gmail.googleapis.com");
  });

  it("blocks a host that is not on the allowlist", async () => {
    guard = installNetworkGuard({ respond: () => jsonResponse({}) });

    await expect(fetch("https://telemetry.example.com/collect")).rejects.toBeInstanceOf(
      PrivacyViolationError,
    );

    expect(guard.violations).toHaveLength(1);
    expect(guard.violations[0]?.host).toBe("telemetry.example.com");
  });

  it("allows localhost, which is where Ollama and the dashboard live", async () => {
    guard = installNetworkGuard({ respond: () => jsonResponse({ models: [] }) });

    await fetch("http://localhost:11434/api/tags");
    await fetch("http://127.0.0.1:7777/api/decisions");

    expect(guard.violations).toStrictEqual([]);
  });

  it("takes an extra host, for the user's own IMAP server", async () => {
    guard = installNetworkGuard({
      allow: ["imap.fastmail.com"],
      respond: () => jsonResponse({}),
    });

    await fetch("https://imap.fastmail.com/");

    expect(guard.violations).toStrictEqual([]);
  });

  it("blocks an allowed host when there is no canned response, rather than going out", async () => {
    guard = installNetworkGuard();

    await expect(fetch("https://gmail.googleapis.com/x")).rejects.toBeInstanceOf(
      LiveConnectionError,
    );
  });

  it("catches a request made through node:https instead of fetch", () => {
    guard = installNetworkGuard();

    expect(() => https.request("https://analytics.example.com/beacon")).toThrow(
      PrivacyViolationError,
    );
    expect(() => https.get({ hostname: "cdn.example.com", path: "/font.woff2" })).toThrow(
      PrivacyViolationError,
    );

    expect(guard.violations.map((attempt) => attempt.host)).toStrictEqual([
      "analytics.example.com",
      "cdn.example.com",
    ]);
  });

  it("catches a DNS lookup for a host that is not allowed", () => {
    guard = installNetworkGuard();

    let reported: Error | undefined;
    dns.lookup("tracker.example.com", (error) => {
      reported = error ?? undefined;
    });

    expect(reported).toBeInstanceOf(PrivacyViolationError);
    expect(guard.violations[0]?.host).toBe("tracker.example.com");
  });

  it("puts the globals back when it is restored", () => {
    const fetchBefore = globalThis.fetch;
    const requestBefore = https.request;

    const temporary = installNetworkGuard({ respond: () => jsonResponse({}) });
    expect(globalThis.fetch).not.toBe(fetchBefore);
    expect(https.request).not.toBe(requestBefore);

    temporary.restore();
    expect(globalThis.fetch).toBe(fetchBefore);
    expect(https.request).toBe(requestBefore);
  });
});
