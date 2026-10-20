import {
  accountId,
  emailId,
  threadId,
  type Email,
  type MailAccount,
  type Clock,
} from "@cleamail/core";

export const TEST_ACCOUNT: MailAccount = {
  id: accountId("acct-1"),
  kind: "gmail",
  address: "user@example.com",
};

/** A clock the tests can move, so `firstSeenAt` and `updatedAt` are observable. */
export function mutableClock(start: Date): Clock & { set(at: Date): void } {
  let current = start;

  return {
    now: () => new Date(current.getTime()),
    set: (at: Date) => {
      current = at;
    },
  };
}

export function anEmail(overrides: Partial<Email> = {}): Email {
  return {
    id: emailId("msg-1"),
    threadId: threadId("thread-1"),
    accountId: TEST_ACCOUNT.id,
    from: { address: "news@shop.example", name: "Shop" },
    to: [{ address: "user@example.com" }],
    cc: [],
    subject: "Your weekly digest",
    snippet: "This week in shopping",
    bodyText: "Plain text body.",
    headers: { "list-unsubscribe": "<mailto:unsub@shop.example>" },
    providerLabels: ["CATEGORY_PROMOTIONS"],
    isRead: false,
    isStarred: false,
    isInInbox: true,
    receivedAt: new Date("2026-10-01T10:00:00.000Z"),
    sizeBytes: 2048,
    ...overrides,
  };
}
