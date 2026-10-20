import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import { err, failure, ok, type OAuthToken, type Result } from "@cleamail/core";
import { z } from "zod";
import { GOOGLE_AUTH_URL, GOOGLE_TOKEN_URL } from "../hosts.js";
import { scopeString } from "./scopes.js";

/**
 * Google's installed-application flow: PKCE over a loopback redirect.
 *
 * There is no hosted callback and no cleamail server anywhere: the browser redirects to a
 * short-lived listener on `127.0.0.1`, which is why this works with no account and no backend. The
 * code verifier never leaves the process and the `state` is compared in constant time, so a local
 * page cannot complete someone else's authorization.
 */

export type FetchLike = typeof globalThis.fetch;

export type PkcePair = {
  readonly verifier: string;
  readonly challenge: string;
};

export function createPkcePair(): PkcePair {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  return { verifier, challenge };
}

export function createState(): string {
  return randomBytes(16).toString("base64url");
}

export type AuthorizationUrlOptions = {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly codeChallenge: string;
  /** Pass the address so Google preselects the right mailbox. */
  readonly loginHint?: string;
};

export function buildAuthorizationUrl(options: AuthorizationUrlOptions): string {
  const url = new URL(GOOGLE_AUTH_URL);

  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopeString());
  url.searchParams.set("state", options.state);
  url.searchParams.set("code_challenge", options.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  // Offline access is what lets the background service refresh without opening a browser again.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  if (options.loginHint !== undefined) url.searchParams.set("login_hint", options.loginHint);

  return url.toString();
}

const PAGE = (message: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"><title>cleamail</title></head><body style="font-family:system-ui;padding:2rem"><h1>cleamail</h1><p>${message}</p></body></html>`;

export type LoopbackReceiver = {
  readonly redirectUri: string;
  /** Resolves with the authorization code once the browser comes back. */
  waitForCode(expectedState: string, timeoutMs?: number): Promise<Result<string>>;
  close(): void;
};

function constantTimeEquals(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);

  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Starts a one-request listener on a free loopback port and reports the redirect URI to register
 * with Google. It binds `127.0.0.1` explicitly: never a public interface.
 */
export async function startLoopbackReceiver(): Promise<LoopbackReceiver> {
  const server: Server = createServer();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  return {
    redirectUri,

    waitForCode(expectedState: string, timeoutMs = 300_000): Promise<Result<string>> {
      return new Promise<Result<string>>((resolve) => {
        const timer = setTimeout(() => {
          finish(failure("provider_auth", "Authorization timed out. Nothing was changed."));
        }, timeoutMs);

        const finish = (result: Result<string>): void => {
          clearTimeout(timer);
          server.removeAllListeners("request");
          resolve(result);
        };

        server.on("request", (request, response) => {
          const url = new URL(request.url ?? "/", redirectUri);
          const code = url.searchParams.get("code");
          const state = url.searchParams.get("state");
          const error = url.searchParams.get("error");

          const reply = (status: number, message: string): void => {
            response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
            response.end(PAGE(message));
          };

          if (error !== null) {
            reply(400, "Authorization was declined. You can close this tab.");
            finish(failure("provider_auth", `Google reported "${error}".`));
            return;
          }

          if (state === null || !constantTimeEquals(state, expectedState)) {
            reply(400, "That request did not come from cleamail. You can close this tab.");
            finish(failure("provider_auth", "The authorization state did not match."));
            return;
          }

          if (code === null || code === "") {
            reply(400, "No authorization code arrived. You can close this tab.");
            finish(failure("provider_auth", "Google did not return an authorization code."));
            return;
          }

          reply(200, "cleamail is connected. You can close this tab and go back to the terminal.");
          finish(ok(code));
        });
      });
    },

    close(): void {
      server.close();
    },
  };
}

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
});

function toToken(
  parsed: z.infer<typeof TokenResponseSchema>,
  fallbackRefreshToken: string | undefined,
  now: Date,
): OAuthToken {
  const refreshToken = parsed.refresh_token ?? fallbackRefreshToken;
  const expiresAt =
    parsed.expires_in === undefined
      ? undefined
      : new Date(now.getTime() + parsed.expires_in * 1000);

  return {
    accessToken: parsed.access_token,
    ...(refreshToken === undefined ? {} : { refreshToken }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    scopes: parsed.scope === undefined ? [] : parsed.scope.split(" ").filter((s) => s !== ""),
  };
}

export type ClientCredentials = {
  readonly clientId: string;
  /** Google issues a "secret" for desktop clients; with PKCE it is not a secret, but it is sent. */
  readonly clientSecret?: string;
};

export type TokenExchangeOptions = ClientCredentials & {
  readonly code: string;
  readonly codeVerifier: string;
  readonly redirectUri: string;
  readonly fetchImpl?: FetchLike;
  readonly now?: Date;
};

async function postToken(
  body: URLSearchParams,
  fetchImpl: FetchLike,
  fallbackRefreshToken: string | undefined,
  now: Date,
): Promise<Result<OAuthToken>> {
  let response: Response;

  try {
    response = await fetchImpl(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (cause) {
    return failure("provider_unavailable", "Could not reach Google to exchange the token.", cause);
  }

  if (!response.ok) {
    // The body can contain the client id; the message deliberately carries only the status.
    return failure("provider_auth", `Google rejected the token request (${response.status}).`);
  }

  const parsed = TokenResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    return failure("provider_auth", "Google returned a token response cleamail cannot read.");
  }

  return ok(toToken(parsed.data, fallbackRefreshToken, now));
}

export function exchangeAuthorizationCode(
  options: TokenExchangeOptions,
): Promise<Result<OAuthToken>> {
  const body = new URLSearchParams({
    client_id: options.clientId,
    code: options.code,
    code_verifier: options.codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: options.redirectUri,
  });

  if (options.clientSecret !== undefined) body.set("client_secret", options.clientSecret);

  return postToken(
    body,
    options.fetchImpl ?? globalThis.fetch,
    undefined,
    options.now ?? new Date(),
  );
}

export type RefreshOptions = ClientCredentials & {
  readonly refreshToken: string;
  readonly fetchImpl?: FetchLike;
  readonly now?: Date;
};

export function refreshAccessToken(options: RefreshOptions): Promise<Result<OAuthToken>> {
  const body = new URLSearchParams({
    client_id: options.clientId,
    refresh_token: options.refreshToken,
    grant_type: "refresh_token",
  });

  if (options.clientSecret !== undefined) body.set("client_secret", options.clientSecret);

  return postToken(
    body,
    options.fetchImpl ?? globalThis.fetch,
    options.refreshToken,
    options.now ?? new Date(),
  );
}

/** Rejects a token that somehow came back with more access than cleamail asks for. */
export function hasOnlyAllowedScopes(
  token: OAuthToken,
  forbidden: readonly string[],
): Result<void> {
  const offending = token.scopes.filter((scope) => forbidden.includes(scope));

  return offending.length === 0
    ? ok(undefined)
    : err({
        code: "provider_auth",
        message: `The authorization includes scopes cleamail must not have: ${offending.join(", ")}.`,
      });
}
