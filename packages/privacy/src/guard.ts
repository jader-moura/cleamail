import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { hostOf, isNetworkAllowed, normalizeHost } from "./allowlist.js";

/**
 * Intercepts every outbound call a test can make and records where it was headed.
 *
 * It patches `fetch`, `http`/`https` requests and DNS lookups. An allowed host is recorded and then
 * answered from the canned responder, so the code under test runs without ever leaving the machine.
 * A host that is not on the allowlist is recorded as a violation and the call throws, which is what
 * makes "no other outbound calls" a statement a test can prove rather than a promise in a README.
 */

export type GuardAttempt = {
  readonly host: string;
  readonly target: string;
  readonly via: "fetch" | "http" | "https" | "dns";
  readonly allowed: boolean;
};

export type GuardOptions = {
  /** Extra hosts for this run, such as the IMAP server from the user's settings. */
  readonly allow?: readonly string[];
  /** Answers allowed `fetch` calls, so clients under test get a response. */
  readonly respond?: (url: string, init?: RequestInit) => Response | Promise<Response>;
};

export type NetworkGuard = {
  readonly attempts: readonly GuardAttempt[];
  readonly violations: readonly GuardAttempt[];
  restore(): void;
};

export class PrivacyViolationError extends Error {
  constructor(readonly host: string) {
    super(
      `Blocked an outbound request to "${host}". cleamail may only reach the user's mail provider and localhost.`,
    );
    this.name = "PrivacyViolationError";
  }
}

/** Thrown for an allowed host: tests record the intent, they never open a real connection. */
export class LiveConnectionError extends Error {
  constructor(readonly host: string) {
    super(`The privacy guard blocked a live connection to "${host}". Provide a canned response.`);
    this.name = "LiveConnectionError";
  }
}

type RequestArgs = Parameters<typeof https.request>;

function targetFromRequestArgs(args: RequestArgs): string {
  const [first, second] = args;

  if (typeof first === "string") return first;
  if (first instanceof URL) return first.toString();

  const options = typeof second === "object" && second !== null ? second : first;

  if (typeof options === "object" && options !== null && !(options instanceof URL)) {
    const host = options.hostname ?? options.host ?? "localhost";
    const protocol = options.protocol ?? "https:";
    const path = options.path ?? "/";

    return `${protocol}//${String(host)}${String(path)}`;
  }

  return "unknown://unknown";
}

export function installNetworkGuard(options: GuardOptions = {}): NetworkGuard {
  const attempts: GuardAttempt[] = [];
  const extra = options.allow ?? [];

  const originalFetch = globalThis.fetch;
  const originalHttpRequest = http.request;
  const originalHttpGet = http.get;
  const originalHttpsRequest = https.request;
  const originalHttpsGet = https.get;
  const originalLookup = dns.lookup;

  const record = (target: string, via: GuardAttempt["via"], rawHost?: string): GuardAttempt => {
    const host = rawHost === undefined ? (hostOf(target) ?? "unknown") : normalizeHost(rawHost);
    const attempt: GuardAttempt = { host, target, via, allowed: isNetworkAllowed(host, extra) };

    attempts.push(attempt);

    return attempt;
  };

  type FetchInput = Parameters<typeof globalThis.fetch>[0];

  const targetOf = (input: FetchInput): string => {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.toString();

    return typeof input === "object" && "url" in input ? input.url : "unknown://unknown";
  };

  globalThis.fetch = async (input: FetchInput, init?: RequestInit): Promise<Response> => {
    const target = targetOf(input);
    const attempt = record(target, "fetch");

    if (!attempt.allowed) throw new PrivacyViolationError(attempt.host);
    if (options.respond === undefined) throw new LiveConnectionError(attempt.host);

    return options.respond(target, init);
  };

  const blockRequest =
    (via: "http" | "https") =>
    (...args: RequestArgs): never => {
      const attempt = record(targetFromRequestArgs(args), via);

      throw attempt.allowed
        ? new LiveConnectionError(attempt.host)
        : new PrivacyViolationError(attempt.host);
    };

  http.request = blockRequest("http") as typeof http.request;
  http.get = blockRequest("http") as typeof http.get;
  https.request = blockRequest("https") as typeof https.request;
  https.get = blockRequest("https") as typeof https.get;

  dns.lookup = ((hostname: string, ...rest: unknown[]) => {
    const attempt = record(`dns://${hostname}`, "dns", hostname);
    const callback = rest.find((argument) => typeof argument === "function");

    const error = attempt.allowed
      ? new LiveConnectionError(attempt.host)
      : new PrivacyViolationError(attempt.host);

    if (typeof callback === "function") {
      (callback as (err: Error) => void)(error);

      return undefined;
    }

    throw error;
  }) as unknown as typeof dns.lookup;

  return {
    attempts,
    get violations() {
      return attempts.filter((attempt) => !attempt.allowed);
    },
    restore() {
      globalThis.fetch = originalFetch;
      http.request = originalHttpRequest;
      http.get = originalHttpGet;
      https.request = originalHttpsRequest;
      https.get = originalHttpsGet;
      dns.lookup = originalLookup;
    },
  };
}
