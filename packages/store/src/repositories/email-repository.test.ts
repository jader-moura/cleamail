import { accountId, emailId, threadId } from "@cleamail/core";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emails } from "../schema.js";
import { openInMemoryStore, type Store } from "../store.js";
import { anEmail, mutableClock, TEST_ACCOUNT } from "../test/fixtures.js";

const START = new Date("2026-10-02T08:00:00.000Z");

describe("SqliteEmailStore", () => {
  let store: Store;
  let clock: ReturnType<typeof mutableClock>;

  beforeEach(async () => {
    clock = mutableClock(START);
    store = openInMemoryStore({ clock });

    const saved = await store.accounts.upsert(TEST_ACCOUNT);
    expect(saved.ok).toBe(true);
  });

  afterEach(() => {
    store.close();
  });

  it("round-trips an email through the domain schema", async () => {
    const email = anEmail();

    const saved = await store.emails.saveEmails([email]);
    expect(saved).toStrictEqual({ ok: true, value: { inserted: 1, updated: 0 } });

    const read = await store.emails.getEmail(email.id);
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    expect(read.value).toStrictEqual(email);
  });

  it("reports an unknown id as undefined rather than an error", async () => {
    const read = await store.emails.getEmail(emailId("nope"));

    expect(read).toStrictEqual({ ok: true, value: undefined });
  });

  it("upserts on a second fetch instead of duplicating", async () => {
    const email = anEmail();
    await store.emails.saveEmails([email]);

    const again = await store.emails.saveEmails([{ ...email, isRead: true, isStarred: true }]);
    expect(again).toStrictEqual({ ok: true, value: { inserted: 0, updated: 1 } });

    const total = await store.emails.countEmails(TEST_ACCOUNT.id);
    expect(total).toStrictEqual({ ok: true, value: 1 });

    const read = await store.emails.getEmail(email.id);
    expect(read.ok && read.value?.isRead).toBe(true);
    expect(read.ok && read.value?.isStarred).toBe(true);
  });

  it("keeps firstSeenAt from the first save, because the trash rule counts from it", async () => {
    const email = anEmail();
    await store.emails.saveEmails([email]);

    const later = new Date("2026-11-02T08:00:00.000Z");
    clock.set(later);
    await store.emails.saveEmails([{ ...email, isRead: true }]);

    const row = store.db.select().from(emails).where(eq(emails.id, email.id)).get();

    expect(row?.firstSeenAt).toStrictEqual(START);
    expect(row?.updatedAt).toStrictEqual(later);
  });

  it("lists newest first, filtered by account and date", async () => {
    const older = anEmail({
      id: emailId("msg-old"),
      receivedAt: new Date("2026-09-01T10:00:00.000Z"),
    });
    const newer = anEmail({
      id: emailId("msg-new"),
      threadId: threadId("thread-2"),
      receivedAt: new Date("2026-10-05T10:00:00.000Z"),
    });

    await store.emails.saveEmails([older, newer]);

    const all = await store.emails.listEmails({ accountId: TEST_ACCOUNT.id });
    expect(all.ok && all.value.map((email) => email.id)).toStrictEqual(["msg-new", "msg-old"]);

    const recent = await store.emails.listEmails({
      accountId: TEST_ACCOUNT.id,
      since: new Date("2026-10-01T00:00:00.000Z"),
    });
    expect(recent.ok && recent.value.map((email) => email.id)).toStrictEqual(["msg-new"]);

    const otherAccount = await store.emails.listEmails({ accountId: accountId("acct-2") });
    expect(otherAccount).toStrictEqual({ ok: true, value: [] });
  });

  it("honours the limit", async () => {
    await store.emails.saveEmails([
      anEmail({ id: emailId("a") }),
      anEmail({ id: emailId("b") }),
      anEmail({ id: emailId("c") }),
    ]);

    const page = await store.emails.listEmails({ accountId: TEST_ACCOUNT.id, limit: 2 });
    expect(page.ok && page.value).toHaveLength(2);
  });

  it("saves nothing for an empty batch", async () => {
    expect(await store.emails.saveEmails([])).toStrictEqual({
      ok: true,
      value: { inserted: 0, updated: 0 },
    });
  });

  it("fails cleanly when the account does not exist", async () => {
    const orphan = anEmail({ accountId: accountId("missing") });

    const saved = await store.emails.saveEmails([orphan]);
    expect(saved.ok).toBe(false);
    if (saved.ok) return;

    expect(saved.error.code).toBe("store_failure");
  });

  it("records and reads the last sync time", async () => {
    expect(await store.emails.lastSyncAt(TEST_ACCOUNT.id)).toStrictEqual({
      ok: true,
      value: undefined,
    });

    const at = new Date("2026-10-02T09:30:00.000Z");
    expect(await store.emails.recordSync(TEST_ACCOUNT.id, at)).toStrictEqual({
      ok: true,
      value: undefined,
    });
    expect(await store.emails.lastSyncAt(TEST_ACCOUNT.id)).toStrictEqual({ ok: true, value: at });
  });

  it("reports recording a sync for an unknown account as not_found", async () => {
    const recorded = await store.emails.recordSync(accountId("ghost"), START);

    expect(recorded.ok).toBe(false);
    if (recorded.ok) return;
    expect(recorded.error.code).toBe("not_found");
  });
});
