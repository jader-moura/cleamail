import { accountId, fixedClock, ok, threadId, emailId, type Email } from "@cleamail/core";
import {
  InMemorySecretStore,
  InMemoryTokenStore,
  saveClientCredentials,
} from "@cleamail/providers";
import { FakeMailProvider } from "@cleamail/providers/testing";
import { openInMemoryStore, type Store } from "@cleamail/store";
import type { CliDeps } from "../deps.js";
import type { LoopbackReceiver, MailAccount, OAuthToken } from "../ports.js";

export const NOW = new Date("2026-10-20T12:00:00.000Z");

export const ACCOUNT: MailAccount = {
  id: accountId("user@example.com"),
  kind: "gmail",
  address: "user@example.com",
};

export function anEmail(overrides: Partial<Email> = {}): Email {
  return {
    id: emailId("msg-1"),
    threadId: threadId("thread-1"),
    accountId: ACCOUNT.id,
    from: { address: "news@shop.example", name: "Shop" },
    to: [{ address: "user@example.com" }],
    cc: [],
    subject: "Weekly digest",
    snippet: "This week",
    bodyText: "Body.",
    headers: { "list-unsubscribe": "<mailto:u@shop.example>" },
    providerLabels: ["INBOX"],
    isRead: false,
    isStarred: false,
    isInInbox: true,
    receivedAt: new Date("2026-10-19T10:00:00.000Z"),
    sizeBytes: 1024,
    ...overrides,
  };
}

export type Harness = {
  readonly deps: CliDeps;
  readonly store: Store;
  readonly stdout: string[];
  readonly stderr: string[];
  readonly provider: FakeMailProvider;
  readonly tokens: InMemoryTokenStore;
  readonly secrets: InMemorySecretStore;
  readonly answers: string[];
  readonly opened: string[];
  output(): string;
  errors(): string;
  close(): void;
};

export type HarnessOptions = {
  readonly emails?: readonly Email[];
  readonly connected?: boolean;
  readonly answers?: readonly string[];
  readonly ollama?: boolean;
  readonly env?: Record<string, string | undefined>;
  readonly code?: string;
  readonly token?: OAuthToken;
};

/** A whole CLI, wired to the in-memory store, the fake provider and scripted answers. */
export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const store = openInMemoryStore({ clock: fixedClock(NOW) });
  const tokens = new InMemoryTokenStore();
  const secrets = new InMemorySecretStore();
  const provider = new FakeMailProvider({
    address: ACCOUNT.address,
    emails: options.emails ?? [],
  });

  const stdout: string[] = [];
  const stderr: string[] = [];
  const answers = [...(options.answers ?? [])];
  const opened: string[] = [];

  if (options.connected !== false) {
    await store.accounts.upsert(ACCOUNT);
    await saveClientCredentials(secrets, { clientId: "client-1", clientSecret: "secret-1" });
    await tokens.set(ACCOUNT.id, { accessToken: "at-1", refreshToken: "rt-1", scopes: [] });
  }

  const receiver: LoopbackReceiver = {
    redirectUri: "http://127.0.0.1:65000/callback",
    waitForCode: () => Promise.resolve(ok(options.code ?? "code-1")),
    close: () => undefined,
  };

  const deps: CliDeps = {
    out: (line) => stdout.push(line),
    err: (line) => stderr.push(line),
    env: options.env ?? {},
    clock: fixedClock(NOW),
    store,
    tokens,
    secrets,
    makeProvider: () => provider,
    makeProviderForToken: () => provider,
    prompt: () => Promise.resolve(answers.shift() ?? ""),
    openUrl: (url) => {
      opened.push(url);

      return Promise.resolve();
    },
    oauth: {
      startReceiver: () => Promise.resolve(receiver),
      exchange: () =>
        Promise.resolve(
          ok(
            options.token ?? {
              accessToken: "at-new",
              refreshToken: "rt-new",
              scopes: ["https://www.googleapis.com/auth/gmail.modify"],
            },
          ),
        ),
    },
    checkOllama: () =>
      Promise.resolve(
        options.ollama === false
          ? { ok: false, error: { code: "provider_unavailable", message: "not reachable" } }
          : ok(["qwen2.5:7b", "nomic-embed-text"]),
      ),
  };

  return {
    deps,
    store,
    stdout,
    stderr,
    provider,
    tokens,
    secrets,
    answers,
    opened,
    output: () => stdout.join("\n"),
    errors: () => stderr.join("\n"),
    close: () => {
      store.close();
    },
  };
}
