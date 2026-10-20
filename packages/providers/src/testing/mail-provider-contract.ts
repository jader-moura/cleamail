import {
  LABEL_CLEANED,
  type Action,
  type Email,
  type EmailId,
  type MailProvider,
} from "@cleamail/core";
import { describe, expect, it } from "vitest";

export type ContractSubject = {
  readonly provider: MailProvider;
  /** Trashing is the one state the port cannot read back, so each adapter exposes it here. */
  isTrashed(id: EmailId): Promise<boolean>;
};

export type ContractFactory = (
  emails: readonly Email[],
) => ContractSubject | Promise<ContractSubject>;

async function readEmail(provider: MailProvider, id: EmailId): Promise<Email> {
  const read = await provider.getEmail(id);
  if (!read.ok) throw new Error(`Expected to read ${id}: ${read.error.message}`);

  return read.value;
}

/**
 * The behaviour every mail adapter must share.
 *
 * Both the Gmail adapter and the in-memory fake run this suite, and the IMAP adapter in SPEC-021
 * will too. It is the only thing that makes "tested against the fake" a meaningful statement about
 * the real provider, and it pins down the part that matters most: that reversing an action puts the
 * mailbox back exactly as it was.
 */
export function describeMailProviderContract(name: string, createSubject: ContractFactory): void {
  describe(`${name} (MailProvider contract)`, () => {
    const anEmail = (overrides: Partial<Email>): Email => ({
      id: "msg-1" as Email["id"],
      threadId: "thread-1" as Email["threadId"],
      accountId: "user@example.com" as Email["accountId"],
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
      receivedAt: new Date("2026-10-05T10:00:00.000Z"),
      sizeBytes: 1024,
      ...overrides,
    });

    const seeded = anEmail({});
    const older = anEmail({
      id: "msg-old" as Email["id"],
      receivedAt: new Date("2026-08-01T10:00:00.000Z"),
    });

    const since = new Date("2026-10-01T00:00:00.000Z");

    it("reports the connected account", async () => {
      const { provider } = await createSubject([seeded]);

      const account = await provider.account();

      expect(account.ok).toBe(true);
      if (!account.ok) return;
      expect(account.value.address).toBe("user@example.com");
    });

    it("lists only messages in the window", async () => {
      const { provider } = await createSubject([seeded, older]);

      const page = await provider.listEmails({ since });

      expect(page.ok).toBe(true);
      if (!page.ok) return;
      expect(page.value.emails.map((email) => email.id)).toStrictEqual([seeded.id]);
    });

    it("reads one message", async () => {
      const { provider } = await createSubject([seeded]);

      const email = await readEmail(provider, seeded.id);

      expect(email.subject).toBe(seeded.subject);
      expect(email.from.address).toBe(seeded.from.address);
    });

    it("reports an unknown message as an error, not an empty email", async () => {
      const { provider } = await createSubject([seeded]);

      const read = await provider.getEmail("missing" as EmailId);

      expect(read.ok).toBe(false);
    });

    it("applies the default clean: label and archive", async () => {
      const { provider } = await createSubject([seeded]);

      const applied = await provider.applyActions(seeded.id, [
        { type: "label", label: LABEL_CLEANED, hadLabel: false },
        { type: "archive", wasInInbox: true },
      ]);
      expect(applied.ok).toBe(true);

      const email = await readEmail(provider, seeded.id);
      expect(email.providerLabels).toContain(LABEL_CLEANED);
      expect(email.isInInbox).toBe(false);
    });

    it("stars and marks read", async () => {
      const { provider } = await createSubject([seeded]);

      await provider.applyActions(seeded.id, [
        { type: "star", wasStarred: false },
        { type: "mark_read", wasRead: false },
      ]);

      const email = await readEmail(provider, seeded.id);
      expect(email.isStarred).toBe(true);
      expect(email.isRead).toBe(true);
    });

    it("moves to trash", async () => {
      const subject = await createSubject([seeded]);

      await subject.provider.applyActions(seeded.id, [
        { type: "trash", wasInInbox: true, previousLabels: ["INBOX"] },
      ]);

      expect(await subject.isTrashed(seeded.id)).toBe(true);
    });

    it("puts the mailbox back when actions are reversed", async () => {
      const subject = await createSubject([seeded]);
      const actions: Action[] = [
        { type: "label", label: LABEL_CLEANED, hadLabel: false },
        { type: "archive", wasInInbox: true },
        { type: "mark_read", wasRead: false },
      ];

      await subject.provider.applyActions(seeded.id, actions);
      await subject.provider.reverseActions(seeded.id, actions);

      const email = await readEmail(subject.provider, seeded.id);
      expect(email.providerLabels).not.toContain(LABEL_CLEANED);
      expect(email.isInInbox).toBe(true);
      expect(email.isRead).toBe(false);
    });

    it("restores a trashed message", async () => {
      const subject = await createSubject([seeded]);
      const actions: Action[] = [{ type: "trash", wasInInbox: true, previousLabels: ["INBOX"] }];

      await subject.provider.applyActions(seeded.id, actions);
      await subject.provider.reverseActions(seeded.id, actions);

      expect(await subject.isTrashed(seeded.id)).toBe(false);
      expect((await readEmail(subject.provider, seeded.id)).isInInbox).toBe(true);
    });

    it("keeps a label the message already had when reversing", async () => {
      const labelled = anEmail({ providerLabels: ["INBOX", LABEL_CLEANED] });
      const subject = await createSubject([labelled]);
      const actions: Action[] = [{ type: "label", label: LABEL_CLEANED, hadLabel: true }];

      await subject.provider.applyActions(labelled.id, actions);
      await subject.provider.reverseActions(labelled.id, actions);

      expect((await readEmail(subject.provider, labelled.id)).providerLabels).toContain(
        LABEL_CLEANED,
      );
    });

    it("creates the labels it owns", async () => {
      const { provider } = await createSubject([seeded]);

      expect(await provider.ensureLabels([LABEL_CLEANED, "cleamail/Review"])).toStrictEqual({
        ok: true,
        value: undefined,
      });
    });
  });
}
