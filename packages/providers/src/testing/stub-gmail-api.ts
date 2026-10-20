import { formatAddress, type Email } from "@cleamail/core";
import type {
  GmailApi,
  GmailLabel,
  GmailListResponse,
  GmailMessage,
  GmailProfile,
  LabelChanges,
  ListMessagesParams,
} from "../gmail/types.js";

const SYSTEM_LABELS = ["INBOX", "UNREAD", "STARRED", "TRASH", "CATEGORY_PROMOTIONS"];

function encode(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

/**
 * Turns a domain email back into Gmail's wire format, so the stub can be seeded with the same
 * fixtures as the fake provider.
 */
function emailToGmailMessage(email: Email, labelIds: readonly string[]): GmailMessage {
  return {
    id: email.id,
    threadId: email.threadId,
    labelIds: [...labelIds],
    snippet: email.snippet,
    internalDate: `${email.receivedAt.getTime()}`,
    sizeEstimate: email.sizeBytes,
    payload: {
      mimeType: "text/plain",
      filename: "",
      headers: [
        { name: "From", value: formatAddress(email.from) },
        { name: "To", value: email.to.map(formatAddress).join(", ") },
        ...(email.cc.length === 0
          ? []
          : [{ name: "Cc", value: email.cc.map(formatAddress).join(", ") }]),
        { name: "Subject", value: email.subject },
        { name: "Date", value: email.receivedAt.toUTCString() },
        ...Object.entries(email.headers)
          .filter(([name]) => !["from", "to", "cc", "subject", "date"].includes(name))
          .map(([name, value]) => ({ name, value })),
      ],
      body: { data: encode(email.bodyText) },
    },
  };
}

/**
 * An in-memory Gmail.
 *
 * It behaves like the real API in the ways the adapter depends on: user labels are opaque ids,
 * state lives in label ids, trashing swaps `INBOX` for `TRASH`, and unknown ids throw with a 404.
 * That is what lets the Gmail adapter run the full provider contract without a network.
 */
export class StubGmailApi implements GmailApi {
  private readonly messages = new Map<string, GmailMessage>();
  private readonly labels = new Map<string, GmailLabel>();
  private nextLabelId = 1;

  readonly calls = { listMessages: 0, getMessage: 0, modifyMessage: 0, listLabels: 0 };

  constructor(
    private readonly address = "user@example.com",
    emails: readonly Email[] = [],
  ) {
    for (const name of SYSTEM_LABELS) {
      this.labels.set(name, { id: name, name });
    }

    for (const email of emails) {
      const labelIds = email.providerLabels.map((label) => this.ensureLabel(label).id);

      if (!email.isRead) labelIds.push("UNREAD");
      if (email.isStarred) labelIds.push("STARRED");
      if (email.isInInbox && !labelIds.includes("INBOX")) labelIds.push("INBOX");

      this.messages.set(email.id, emailToGmailMessage(email, [...new Set(labelIds)]));
    }
  }

  getProfile(): Promise<GmailProfile> {
    return Promise.resolve({ emailAddress: this.address });
  }

  listMessages(params: ListMessagesParams): Promise<GmailListResponse> {
    this.calls.listMessages += 1;

    const messages = [...this.messages.values()]
      .filter((message) => !message.labelIds.includes("TRASH"))
      .sort((left, right) => Number(right.internalDate ?? 0) - Number(left.internalDate ?? 0))
      .slice(0, params.maxResults ?? 100)
      .map((message) => ({ id: message.id, threadId: message.threadId }));

    return Promise.resolve({ messages });
  }

  getMessage(id: string): Promise<GmailMessage> {
    this.calls.getMessage += 1;

    const message = this.messages.get(id);
    if (message === undefined) return Promise.reject(notFound(id));

    return Promise.resolve(message);
  }

  modifyMessage(id: string, changes: LabelChanges): Promise<void> {
    this.calls.modifyMessage += 1;

    const message = this.messages.get(id);
    if (message === undefined) return Promise.reject(notFound(id));

    const labelIds = new Set(message.labelIds);
    for (const add of changes.addLabelIds ?? []) labelIds.add(add);
    for (const remove of changes.removeLabelIds ?? []) labelIds.delete(remove);

    this.messages.set(id, { ...message, labelIds: [...labelIds] });

    return Promise.resolve();
  }

  trashMessage(id: string): Promise<void> {
    return this.moveTrash(id, true);
  }

  untrashMessage(id: string): Promise<void> {
    return this.moveTrash(id, false);
  }

  listLabels(): Promise<GmailLabel[]> {
    this.calls.listLabels += 1;

    return Promise.resolve([...this.labels.values()]);
  }

  createLabel(name: string): Promise<GmailLabel> {
    return Promise.resolve(this.ensureLabel(name));
  }

  /** Test helper: Gmail keeps trashed mail for 30 days, which is what undo relies on. */
  isTrashed(id: string): boolean {
    return this.messages.get(id)?.labelIds.includes("TRASH") ?? false;
  }

  private moveTrash(id: string, trashed: boolean): Promise<void> {
    const message = this.messages.get(id);
    if (message === undefined) return Promise.reject(notFound(id));

    const labelIds = new Set(message.labelIds);

    if (trashed) {
      labelIds.add("TRASH");
      labelIds.delete("INBOX");
    } else {
      labelIds.delete("TRASH");
    }

    this.messages.set(id, { ...message, labelIds: [...labelIds] });

    return Promise.resolve();
  }

  private ensureLabel(name: string): GmailLabel {
    const existing = this.labels.get(name);
    if (existing !== undefined) return existing;

    // User labels get opaque ids, exactly like Gmail, so the adapter has to resolve them.
    const label: GmailLabel = { id: `Label_${this.nextLabelId}`, name };
    this.nextLabelId += 1;
    this.labels.set(name, label);

    return label;
  }
}

function notFound(id: string): Error & { status: number } {
  return Object.assign(new Error(`No message ${id}.`), { status: 404 });
}
