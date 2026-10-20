import {
  accountId as toAccountId,
  err,
  ok,
  silentLogger,
  type Action,
  type Email,
  type EmailId,
  type EmailPage,
  type ListEmailsOptions,
  type Logger,
  type MailAccount,
  type MailProvider,
  type MailProviderKind,
  type Result,
} from "@cleamail/core";
import { gmailMessageToEmail } from "./mapper.js";
import { buildFetchQuery } from "./query.js";
import { toDomainError } from "./errors.js";
import type { GmailApi, LabelChanges } from "./types.js";

const GMAIL_STARRED = "STARRED";
const GMAIL_UNREAD = "UNREAD";
const GMAIL_INBOX = "INBOX";

const DEFAULT_MAX_RESULTS = 100;
const FETCH_CONCURRENCY = 5;

export type GmailProviderOptions = {
  readonly logger?: Logger;
};

/** Fetches a batch without hammering the API or serialising it one message at a time. */
async function mapWithConcurrency<T, U>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<U>,
): Promise<U[]> {
  const results: U[] = [];
  results.length = items.length;
  let next = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;

      const item = items[index];
      if (item === undefined) continue;

      results[index] = await fn(item);
    }
  });

  await Promise.all(workers);

  return results;
}

/**
 * Gmail adapter for the {@link MailProvider} port.
 *
 * It talks to the narrow {@link GmailApi} slice rather than the Gmail client directly, which keeps
 * every decision in this file testable without the network, and means no send, draft or delete
 * method is even reachable from here.
 */
export class GmailProvider implements MailProvider {
  readonly kind: MailProviderKind = "gmail";

  private readonly logger: Logger;
  private labelsByName: Map<string, string> | undefined;
  private labelsById = new Map<string, string>();
  private account_: MailAccount | undefined;

  constructor(
    private readonly api: GmailApi,
    options: GmailProviderOptions = {},
  ) {
    this.logger = options.logger ?? silentLogger;
  }

  async account(): Promise<Result<MailAccount>> {
    if (this.account_ !== undefined) return ok(this.account_);

    try {
      const profile = await this.api.getProfile();

      // The address is the account id: stable, readable in the audit log, and unique per mailbox.
      this.account_ = {
        id: toAccountId(profile.emailAddress),
        kind: "gmail",
        address: profile.emailAddress,
      };

      return ok(this.account_);
    } catch (cause) {
      return err(toDomainError(cause, "Could not read the Gmail profile."));
    }
  }

  async listEmails(options: ListEmailsOptions): Promise<Result<EmailPage>> {
    const account = await this.account();
    if (!account.ok) return account;

    const loaded = await this.loadLabels();
    if (!loaded.ok) return loaded;

    try {
      const listed = await this.api.listMessages({
        query: buildFetchQuery(options.since),
        maxResults: options.maxResults ?? DEFAULT_MAX_RESULTS,
        ...(options.pageToken === undefined ? {} : { pageToken: options.pageToken }),
      });

      const fetched = await mapWithConcurrency(listed.messages, FETCH_CONCURRENCY, async (ref) =>
        this.fetchOne(ref.id, account.value.address),
      );

      const emails: Email[] = [];
      let skipped = 0;

      for (const result of fetched) {
        if (result === undefined) {
          skipped += 1;
          continue;
        }

        // Gmail's `after:` is day-granular, so the window is trimmed precisely here.
        if (result.receivedAt.getTime() < options.since.getTime()) continue;

        emails.push(result);
      }

      if (skipped > 0) {
        // A message we cannot map is left completely alone: no decision, no action, still in place.
        this.logger.warn("Skipped messages that could not be mapped", { count: skipped });
      }

      return ok({
        emails,
        ...(listed.nextPageToken === undefined ? {} : { nextPageToken: listed.nextPageToken }),
      });
    } catch (cause) {
      return err(toDomainError(cause, "Could not list Gmail messages."));
    }
  }

  async getEmail(id: EmailId): Promise<Result<Email>> {
    const account = await this.account();
    if (!account.ok) return account;

    const loaded = await this.loadLabels();
    if (!loaded.ok) return loaded;

    try {
      const message = await this.api.getMessage(id);

      return gmailMessageToEmail(message, account.value.address, this.labelsById);
    } catch (cause) {
      return err(toDomainError(cause, `Could not read Gmail message ${id}.`));
    }
  }

  async applyActions(id: EmailId, actions: readonly Action[]): Promise<Result<void>> {
    const changes = await this.changesFor(actions, "apply");
    if (!changes.ok) return changes;

    return this.runChanges(id, changes.value.labels, changes.value.trash, changes.value.untrash);
  }

  async reverseActions(id: EmailId, actions: readonly Action[]): Promise<Result<void>> {
    const changes = await this.changesFor(actions, "reverse");
    if (!changes.ok) return changes;

    return this.runChanges(id, changes.value.labels, changes.value.trash, changes.value.untrash);
  }

  async ensureLabels(labels: readonly string[]): Promise<Result<void>> {
    for (const label of labels) {
      const id = await this.labelId(label);
      if (!id.ok) return id;
    }

    return ok(undefined);
  }

  private async fetchOne(id: string, account: string): Promise<Email | undefined> {
    const message = await this.api.getMessage(id);
    const email = gmailMessageToEmail(message, account, this.labelsById);

    if (!email.ok) {
      this.logger.warn("Message could not be mapped", { messageId: id, reason: email.error.code });
      return undefined;
    }

    return email.value;
  }

  /**
   * Turns actions into one set of label changes plus at most one trash move.
   *
   * Collapsing into a single modify call keeps the inbox from flickering through intermediate
   * states, and makes the apply either happen or not.
   */
  private async changesFor(
    actions: readonly Action[],
    direction: "apply" | "reverse",
  ): Promise<Result<{ labels: LabelChanges; trash: boolean; untrash: boolean }>> {
    const add = new Set<string>();
    const remove = new Set<string>();
    let trash = false;
    let untrash = false;

    for (const action of actions) {
      switch (action.type) {
        case "label": {
          const id = await this.labelId(action.label);
          if (!id.ok) return id;

          // Reversing only removes a label the message did not already have.
          if (direction === "apply") add.add(id.value);
          else if (!action.hadLabel) remove.add(id.value);
          break;
        }
        case "star": {
          if (direction === "apply") add.add(GMAIL_STARRED);
          else if (!action.wasStarred) remove.add(GMAIL_STARRED);
          break;
        }
        case "archive": {
          if (direction === "apply") remove.add(GMAIL_INBOX);
          else if (action.wasInInbox) add.add(GMAIL_INBOX);
          break;
        }
        case "mark_read": {
          if (direction === "apply") remove.add(GMAIL_UNREAD);
          else if (!action.wasRead) add.add(GMAIL_UNREAD);
          break;
        }
        case "trash": {
          if (direction === "apply") trash = true;
          else {
            untrash = true;
            if (action.wasInInbox) add.add(GMAIL_INBOX);
          }
          break;
        }
      }
    }

    return ok({
      labels: { addLabelIds: [...add], removeLabelIds: [...remove] },
      trash,
      untrash,
    });
  }

  private async runChanges(
    id: EmailId,
    labels: LabelChanges,
    trash: boolean,
    untrash: boolean,
  ): Promise<Result<void>> {
    const hasLabelChanges =
      (labels.addLabelIds?.length ?? 0) > 0 || (labels.removeLabelIds?.length ?? 0) > 0;

    try {
      // Untrash first, so label changes land on a message that is back out of the bin.
      if (untrash) await this.api.untrashMessage(id);
      if (hasLabelChanges) await this.api.modifyMessage(id, labels);
      if (trash) await this.api.trashMessage(id);

      return ok(undefined);
    } catch (cause) {
      return err(toDomainError(cause, `Could not update Gmail message ${id}.`));
    }
  }

  /** One `labels.list` call per process, in both directions. */
  private async loadLabels(): Promise<Result<void>> {
    if (this.labelsByName !== undefined) return ok(undefined);

    try {
      const existing = await this.api.listLabels();

      this.labelsByName = new Map(existing.map((label) => [label.name, label.id]));
      this.labelsById = new Map(existing.map((label) => [label.id, label.name]));

      return ok(undefined);
    } catch (cause) {
      return err(toDomainError(cause, "Could not read the Gmail labels."));
    }
  }

  /** Resolves a label name to its id, creating the label the first time it is needed. */
  private async labelId(name: string): Promise<Result<string>> {
    const loaded = await this.loadLabels();
    if (!loaded.ok) return loaded;

    const known = this.labelsByName?.get(name);
    if (known !== undefined) return ok(known);

    try {
      const created = await this.api.createLabel(name);

      this.labelsByName?.set(created.name, created.id);
      this.labelsById.set(created.id, created.name);

      return ok(created.id);
    } catch (cause) {
      return err(toDomainError(cause, `Could not create the label "${name}".`));
    }
  }
}
