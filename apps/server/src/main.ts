#!/usr/bin/env node
import { accountId as toAccountId, failure, ok, systemClock } from "@cleamail/core";
import {
  GmailProvider,
  GmailRestApi,
  KeyringSecretStore,
  KeyringTokenStore,
  RefreshingAccessTokenProvider,
  loadClientCredentials,
} from "@cleamail/providers";
import { DEFAULT_CLASSIFIER_MODEL } from "@cleamail/llm";
import { openStore } from "@cleamail/store";
import { readConfig } from "./config.js";
import type { ServerDeps } from "./deps.js";
import { startServer } from "./start.js";
import { VERSION } from "./version.js";

/**
 * Starts the local service.
 *
 * The composition root: it builds the real adapters and hands them to the app, which holds no
 * knowledge of Gmail, the keychain or SQLite. Nothing here decides anything about an email.
 */
async function main(): Promise<number> {
  const config = readConfig(process.env);
  if (!config.ok) {
    process.stderr.write(`${config.error.message}\n`);

    return 2;
  }

  const store = openStore();
  const tokens = new KeyringTokenStore();
  const secrets = new KeyringSecretStore();

  const deps: ServerDeps = {
    store,
    clock: systemClock,
    classifierModel: process.env["CLEAMAIL_MODEL"] ?? DEFAULT_CLASSIFIER_MODEL,
    version: VERSION,
    connect: async () => {
      const accounts = await store.accounts.list();
      if (!accounts.ok) return accounts;

      const account = accounts.value[0];
      if (account === undefined) {
        return failure("config_invalid", "No mailbox is connected yet. Run `cleamail init` first.");
      }

      const credentials = await loadClientCredentials(secrets);
      if (!credentials.ok) return credentials;
      if (credentials.value === undefined) {
        return failure(
          "config_invalid",
          "No Google OAuth client is stored. Run `cleamail init` to set one up.",
        );
      }

      const provider = new GmailProvider(
        new GmailRestApi(
          new RefreshingAccessTokenProvider({
            accountId: toAccountId(account.id),
            credentials: credentials.value,
            tokens,
          }),
        ),
        {
          // Read when it is asked for, so re-running `init` to widen access takes effect without a
          // restart, and so the dashboard never offers a button the token cannot carry out.
          scopes: async () => {
            const token = await tokens.get(account.id);

            return token.ok ? ok(token.value?.scopes) : token;
          },
        },
      );

      return ok({ account, provider });
    },
  };

  const started = await startServer(deps, { port: config.value.port, logRequests: true });
  if (!started.ok) {
    process.stderr.write(`${started.error.message}\n`);
    store.close();

    return 1;
  }

  process.stdout.write(`cleamail is running on ${started.value.url}\n`);
  process.stdout.write("Nothing is reachable from outside this machine.\n");

  const stop = (): void => {
    void started.value.close().then(() => {
      store.close();
      process.exit(0);
    });
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  // The listening socket keeps the process alive; SIGINT and SIGTERM are what end it.
  return 0;
}

try {
  process.exitCode = await main();
} catch (cause) {
  // Last resort: starting up should have reported this as a typed result.
  const why = cause instanceof Error ? cause.message : "unknown";

  process.stderr.write(`cleamail server failed to start: ${why}\n`);
  process.exitCode = 1;
}
