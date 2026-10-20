#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { accountId as toAccountId, systemClock } from "@cleamail/core";
import {
  exchangeAuthorizationCode,
  GmailProvider,
  GmailRestApi,
  KeyringSecretStore,
  KeyringTokenStore,
  RefreshingAccessTokenProvider,
  StaticAccessTokenProvider,
  startLoopbackReceiver,
} from "@cleamail/providers";
import { openStore } from "@cleamail/store";
import { runCli } from "./cli.js";
import type { CliDeps } from "./deps.js";
import { EXIT } from "./exit.js";
import { createConsoleLogger } from "./logger.js";
import { checkOllama, OLLAMA_DEFAULT_URL } from "./ollama.js";

/** Opens the user's default browser without a dependency. Failure is not fatal: the URL is shown. */
function openUrl(url: string): Promise<void> {
  const [command, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];

  return new Promise((resolve) => {
    try {
      const child = spawn(command, args ?? [], { stdio: "ignore", detached: true });
      child.on("error", () => {
        resolve();
      });
      child.unref();
      resolve();
    } catch {
      resolve();
    }
  });
}

async function main(): Promise<number> {
  const logger = createConsoleLogger((line) => {
    process.stderr.write(`${line}\n`);
  });

  const store = openStore();
  const tokens = new KeyringTokenStore();
  const secrets = new KeyringSecretStore();
  const ollamaUrl = process.env["CLEAMAIL_OLLAMA_URL"] ?? OLLAMA_DEFAULT_URL;

  const deps: CliDeps = {
    out: (line) => {
      process.stdout.write(`${line}\n`);
    },
    err: (line) => {
      process.stderr.write(`${line}\n`);
    },
    env: process.env,
    clock: systemClock,
    store,
    tokens,
    secrets,

    makeProvider: (credentials, accountId) =>
      new GmailProvider(
        new GmailRestApi(
          new RefreshingAccessTokenProvider({
            accountId: toAccountId(accountId),
            credentials,
            tokens,
          }),
        ),
        { logger },
      ),

    makeProviderForToken: (accessToken) =>
      new GmailProvider(new GmailRestApi(new StaticAccessTokenProvider(accessToken)), { logger }),

    prompt: async (question) => {
      const readline = createInterface({ input: process.stdin, output: process.stdout });

      try {
        return await readline.question(question);
      } finally {
        readline.close();
      }
    },

    openUrl,

    oauth: {
      startReceiver: startLoopbackReceiver,
      exchange: (options) =>
        exchangeAuthorizationCode({
          ...options.credentials,
          code: options.code,
          codeVerifier: options.codeVerifier,
          redirectUri: options.redirectUri,
        }),
    },

    checkOllama: () => checkOllama(ollamaUrl),
  };

  try {
    return await runCli(process.argv.slice(2), deps);
  } finally {
    store.close();
  }
}

try {
  process.exitCode = await main();
} catch (cause) {
  // Last resort: a command should have reported this as a typed result.
  process.stderr.write(`cleamail failed: ${cause instanceof Error ? cause.message : "unknown"}\n`);
  process.exitCode = EXIT.failure;
}
