import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";
import type { ApiDecision, ApiEmail, ApiStatus } from "../api.js";

export const NOW = new Date("2026-10-22T12:00:00.000Z");

/** A query client with retries off, so a test asserting on an error state does not wait for one. */
export function renderApp(ui: ReactElement): RenderResult {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

export type StatusOverrides = { [K in keyof ApiStatus]?: ApiStatus[K] | undefined };

export function aStatus(overrides: StatusOverrides = {}): ApiStatus {
  return {
    version: "0.1.0-test",
    database: "/tmp/cleamail.sqlite",
    model: "qwen2.5:7b",
    mailbox: {
      address: "you@example.com",
      kind: "gmail",
      canModify: true,
      messages: 42,
      lastSyncAt: "2026-10-22T11:00:00.000Z",
    },
    ...overrides,
  } as ApiStatus;
}

export function anEmail(overrides: Partial<ApiEmail> = {}): ApiEmail {
  return {
    id: "msg-1",
    subject: "Half price everything",
    from: "news@shop.example",
    fromName: "Shop",
    receivedAt: "2026-10-22T10:00:00.000Z",
    isRead: false,
    isStarred: false,
    isInInbox: true,
    labels: ["INBOX"],
    ...overrides,
  };
}

/**
 * Overrides where `undefined` means "leave this field out".
 *
 * `exactOptionalPropertyTypes` is on, so `{ appliedAt: undefined }` is not the same as an absent
 * `appliedAt`, and a preview genuinely has no applied time. Dropping undefined keys lets a test say
 * which fields the API would not have sent.
 */
export type DecisionOverrides = { [K in keyof ApiDecision]?: ApiDecision[K] | undefined };

export function aDecision(overrides: DecisionOverrides = {}): ApiDecision {
  const base: ApiDecision = {
    id: 1,
    runId: "run-1",
    emailId: "msg-1",
    category: "promotion",
    confidence: 0.95,
    explanation: "It offers a discount.",
    dryRun: false,
    decidedAt: "2026-10-22T11:00:00.000Z",
    appliedAt: "2026-10-22T11:00:01.000Z",
    actions: [
      {
        id: 1,
        type: "label",
        outcome: "applied",
        at: "2026-10-22T11:00:01.000Z",
        reversible: true,
      },
      {
        id: 2,
        type: "archive",
        outcome: "applied",
        at: "2026-10-22T11:00:01.000Z",
        reversible: true,
      },
    ],
  };

  const merged: Record<string, unknown> = { ...base, ...overrides };

  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined) delete merged[key];
  }

  return merged as ApiDecision;
}

export type Routes = {
  readonly status?: ApiStatus;
  readonly decisions?: readonly ApiDecision[];
  readonly emails?: readonly ApiEmail[];
  readonly audit?: readonly { id: number; at: string; kind: string; summary: string }[];
  /** Paths that should answer with an error, as path prefix to status code. */
  readonly failures?: Readonly<Record<string, number>>;
};

/**
 * A fake local service.
 *
 * `fetch` is what the client uses, so this is where the seam is. It records what was asked for, so
 * a test can assert that approving a preview sent the run the user was shown.
 */
export function fakeApi(routes: Routes = {}): { calls: { url: string; body?: unknown }[] } {
  const calls: { url: string; body?: unknown }[] = [];

  const answer = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;

      calls.push(body === undefined ? { url } : { url, body });

      for (const [prefix, status] of Object.entries(routes.failures ?? {})) {
        if (url.startsWith(prefix)) {
          return Promise.resolve(
            answer(
              { error: { code: "store_failure", message: "The database is locked." } },
              status,
            ),
          );
        }
      }

      if (url.startsWith("/api/status")) return Promise.resolve(answer(routes.status ?? aStatus()));
      if (url.startsWith("/api/decisions")) {
        return Promise.resolve(answer({ decisions: routes.decisions ?? [] }));
      }
      if (url.startsWith("/api/emails")) {
        return Promise.resolve(answer({ emails: routes.emails ?? [] }));
      }
      if (url.startsWith("/api/audit"))
        return Promise.resolve(answer({ audit: routes.audit ?? [] }));
      if (url.startsWith("/api/apply")) {
        return Promise.resolve(
          answer({ runId: "apply-1", emailsChanged: 1, applied: 2, skipped: 0, failures: [] }),
        );
      }
      if (url.startsWith("/api/undo")) {
        return Promise.resolve(
          answer({
            runId: "run-1",
            emailsRestored: 1,
            reversed: 2,
            alreadyReversed: 0,
            failures: [],
          }),
        );
      }

      return Promise.resolve(answer({ error: { code: "not_found", message: "No route." } }, 404));
    }),
  );

  return { calls };
}
