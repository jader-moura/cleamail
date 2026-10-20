import {
  accountId as toAccountId,
  failure,
  LABEL_CLEANED,
  ok,
  type Action,
  type Email,
  type EmailId,
  type EmailPage,
  type ListEmailsOptions,
  type MailAccount,
  type MailProvider,
  type MailProviderKind,
  type Result,
} from "@cleamail/core";

export type FakeProviderOptions = {
  readonly address?: string;
  readonly emails?: readonly Email[];
};

/**
 * An in-memory {@link MailProvider}.
 *
 * Every other package tests against this instead of a real mailbox, and it runs the same contract
 * suite as the Gmail adapter, so "works against the fake" means something.
 */
export class FakeMailProvider implements MailProvider {
  readonly kind: MailProviderKind = "gmail";

  private readonly emails = new Map<string, Email>();
  private readonly trashed = new Set<string>();
  private readonly labels = new Set<string>([LABEL_CLEANED]);
  private readonly address: string;

  constructor(options: FakeProviderOptions = {}) {
    this.address = options.address ?? "user@example.com";

    for (const email of options.emails ?? []) {
      this.emails.set(email.id, email);
    }
  }

  account(): Promise<Result<MailAccount>> {
    return Promise.resolve(
      ok({ id: toAccountId(this.address), kind: this.kind, address: this.address }),
    );
  }

  listEmails(options: ListEmailsOptions): Promise<Result<EmailPage>> {
    const emails = [...this.emails.values()]
      .filter((email) => !this.trashed.has(email.id))
      .filter((email) => email.receivedAt.getTime() >= options.since.getTime())
      .sort((left, right) => right.receivedAt.getTime() - left.receivedAt.getTime())
      .slice(0, options.maxResults ?? 100);

    return Promise.resolve(ok({ emails }));
  }

  getEmail(id: EmailId): Promise<Result<Email>> {
    const email = this.emails.get(id);

    return Promise.resolve(
      email === undefined ? failure("not_found", `No message ${id}.`) : ok(email),
    );
  }

  applyActions(id: EmailId, actions: readonly Action[]): Promise<Result<void>> {
    return Promise.resolve(this.mutate(id, actions, "apply"));
  }

  reverseActions(id: EmailId, actions: readonly Action[]): Promise<Result<void>> {
    return Promise.resolve(this.mutate(id, actions, "reverse"));
  }

  ensureLabels(labels: readonly string[]): Promise<Result<void>> {
    for (const label of labels) this.labels.add(label);

    return Promise.resolve(ok(undefined));
  }

  /** Test helpers. */
  isTrashed(id: EmailId): boolean {
    return this.trashed.has(id);
  }

  knownLabels(): readonly string[] {
    return [...this.labels].sort();
  }

  private mutate(
    id: EmailId,
    actions: readonly Action[],
    direction: "apply" | "reverse",
  ): Result<void> {
    const email = this.emails.get(id);
    if (email === undefined) return failure("not_found", `No message ${id}.`);

    let next = email;

    for (const action of actions) {
      switch (action.type) {
        case "label": {
          this.labels.add(action.label);
          const labels = new Set(next.providerLabels);

          if (direction === "apply") labels.add(action.label);
          else if (!action.hadLabel) labels.delete(action.label);

          next = { ...next, providerLabels: [...labels] };
          break;
        }
        case "star": {
          next = { ...next, isStarred: direction === "apply" ? true : action.wasStarred };
          break;
        }
        case "archive": {
          next = { ...next, isInInbox: direction === "apply" ? false : action.wasInInbox };
          break;
        }
        case "mark_read": {
          next = { ...next, isRead: direction === "apply" ? true : action.wasRead };
          break;
        }
        case "trash": {
          if (direction === "apply") {
            this.trashed.add(id);
            next = { ...next, isInInbox: false };
          } else {
            this.trashed.delete(id);
            next = { ...next, isInInbox: action.wasInInbox };
          }
          break;
        }
      }
    }

    this.emails.set(id, next);

    return ok(undefined);
  }
}
