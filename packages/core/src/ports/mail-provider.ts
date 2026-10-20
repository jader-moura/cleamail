import type { Action } from "../domain/action.js";
import type { Email } from "../domain/email.js";
import type { AccountId, EmailId } from "../domain/ids.js";
import type { Result } from "../result.js";

export const MAIL_PROVIDER_KINDS = ["gmail", "imap"] as const;
export type MailProviderKind = (typeof MAIL_PROVIDER_KINDS)[number];

export type ListEmailsOptions = {
  readonly since: Date;
  readonly maxResults?: number;
  readonly pageToken?: string;
};

export type EmailPage = {
  readonly emails: readonly Email[];
  readonly nextPageToken?: string;
};

export type MailAccount = {
  readonly id: AccountId;
  readonly kind: MailProviderKind;
  readonly address: string;
};

/**
 * The only way cleamail touches a mailbox: read messages, apply a planned action, make sure the
 * labels it owns exist. Nothing here can send mail or delete permanently, because those operations
 * do not exist in this port.
 */
export interface MailProvider {
  readonly kind: MailProviderKind;

  /** Identity of the connected mailbox, used to scope stored decisions. */
  account(): Promise<Result<MailAccount>>;

  listEmails(options: ListEmailsOptions): Promise<Result<EmailPage>>;

  getEmail(id: EmailId): Promise<Result<Email>>;

  /** Applies already-decided actions. Providers never decide anything themselves. */
  applyActions(id: EmailId, actions: readonly Action[]): Promise<Result<void>>;

  /** Reverses previously applied actions, for undo. */
  reverseActions(id: EmailId, actions: readonly Action[]): Promise<Result<void>>;

  ensureLabels(labels: readonly string[]): Promise<Result<void>>;
}
