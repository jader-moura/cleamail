import {
  POLICY_VERSION,
  accountId,
  applyDecisions,
  decide,
  emailId,
  fixedClock,
  ok,
  threadId,
  type Decision,
  type Email,
  type MailAccount,
} from "@cleamail/core";
import { FakeMailProvider } from "@cleamail/providers/testing";
import { openInMemoryStore, type Store } from "@cleamail/store";
import type { FastifyInstance } from "fastify";
import { createApp } from "../app.js";
import { DEFAULT_PORT } from "../config.js";
import type { ServerDeps } from "../deps.js";

export const NOW = new Date("2026-10-22T09:00:00.000Z");

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
    to: [{ address: ACCOUNT.address }],
    cc: [],
    subject: "Weekly digest",
    snippet: "This week",
    bodyText: "Body.",
    headers: {},
    providerLabels: ["INBOX"],
    isRead: false,
    isStarred: false,
    isInInbox: true,
    receivedAt: new Date("2026-10-21T10:00:00.000Z"),
    sizeBytes: 1024,
    ...overrides,
  };
}

export type ServerHarness = {
  readonly app: FastifyInstance;
  readonly store: Store;
  readonly provider: FakeMailProvider;
  readonly deps: ServerDeps;
  /** Records a dry run per email, the way `cleamail run` without --apply would. */
  readonly previewRun: (runId: string, emails: readonly Email[]) => Promise<void>;
  /** Applies a cleanable decision per email, the way `cleamail run --apply` would. */
  readonly applyRun: (
    runId: string,
    emails: readonly Email[],
    options?: { readonly unclassified?: boolean },
  ) => Promise<void>;
  readonly close: () => Promise<void>;
};

export type HarnessOptions = {
  readonly emails?: readonly Email[];
  readonly connected?: boolean;
  readonly canModify?: boolean;
  /** False stands in for a keychain that lost the OAuth client, with the account still stored. */
  readonly credentials?: boolean;
};

/** The one error both lookups answer with when `init` has never run. */
function notConnected() {
  return {
    ok: false as const,
    error: {
      code: "config_invalid" as const,
      message: "No mailbox is connected yet. Run `cleamail init` first.",
    },
  };
}

/** A whole server, wired to the in-memory store and the fake mailbox. No socket, no network. */
export async function createServerHarness(options: HarnessOptions = {}): Promise<ServerHarness> {
  const store = openInMemoryStore({ clock: fixedClock(NOW) });
  const provider = new FakeMailProvider({
    address: ACCOUNT.address,
    emails: options.emails ?? [],
    canModify: options.canModify ?? true,
  });

  if (options.connected !== false) {
    await store.accounts.upsert(ACCOUNT);
  }

  if (options.emails !== undefined && options.emails.length > 0) {
    await store.emails.saveEmails(options.emails);
  }

  const deps: ServerDeps = {
    store,
    clock: fixedClock(NOW),
    classifierModel: "qwen2.5:7b",
    version: "0.1.0-test",
    account: async () => {
      const accounts = await store.accounts.list();
      const account = accounts.ok ? accounts.value[0] : undefined;

      return account === undefined ? notConnected() : ok(account);
    },
    connect: async () => {
      const accounts = await store.accounts.list();
      const account = accounts.ok ? accounts.value[0] : undefined;

      if (account === undefined) return notConnected();
      // Standing in for a keychain with no OAuth client in it: the account is there, so reading
      // works, and only the routes that change something are blocked.
      if (options.credentials === false) {
        return {
          ok: false as const,
          error: {
            code: "config_invalid" as const,
            message: "No Google OAuth client is stored. Run `cleamail init` to set one up.",
          },
        };
      }

      return ok({ account, provider });
    },
  };

  const app = createApp(deps, { port: DEFAULT_PORT });
  await app.ready();

  return {
    app,
    store,
    provider,
    deps,
    applyRun: async (runId, emails, runOptions = {}) => {
      const decisions: Decision[] = emails.map((email) =>
        decide({
          email,
          // An unclassified run stands for the model answering with something invalid: the plan is
          // a review label and nothing else, and it has to be recordable like any other.
          outcome:
            runOptions.unclassified === true
              ? {
                  emailId: email.id,
                  hints: [],
                  reviewReason: "invalid_model_output",
                  reviewDetail: "test-model answered with reasoning and no classification.",
                }
              : {
                  emailId: email.id,
                  hints: [],
                  classification: {
                    category: "promotion",
                    importance: 0.1,
                    confidence: 0.95,
                    reason: "It offers a discount.",
                    source: "model",
                    model: "test-model",
                  },
                },
          now: NOW,
        }),
      );

      const applied = await applyDecisions(
        { accountId: ACCOUNT.id, decisions },
        {
          provider,
          decisions: store.decisions,
          audit: store.audit,
          runId,
          now: NOW,
        },
      );

      if (!applied.ok) throw new Error(`Expected the run to apply: ${applied.error.message}`);
    },
    previewRun: async (runId, emails) => {
      const decisions: Decision[] = emails.map((email) =>
        decide({
          email,
          outcome: {
            emailId: email.id,
            hints: [],
            classification: {
              category: "promotion",
              importance: 0.1,
              confidence: 0.95,
              reason: "It offers a discount.",
              source: "model",
              model: "test-model",
            },
          },
          now: NOW,
        }),
      );

      const previewed = await applyDecisions(
        { accountId: ACCOUNT.id, decisions, dryRun: true },
        { provider, decisions: store.decisions, audit: store.audit, runId, now: NOW },
      );

      if (!previewed.ok) throw new Error(`Expected the preview: ${previewed.error.message}`);
    },
    close: async () => {
      await app.close();
      store.close();
    },
  };
}

/** Every request carries a loopback `Host`, because the server refuses anything else. */
export const LOCAL_HEADERS = { host: `127.0.0.1:${String(DEFAULT_PORT)}` };

export { POLICY_VERSION };
