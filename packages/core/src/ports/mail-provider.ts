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
 * What the connection is actually allowed to do.
 *
 * Asked rather than assumed: a mailbox connected with `init --read-only` holds a read-only token,
 * and the executor has to be able to say so in plain words before it tries. The scopes themselves
 * stay in the adapter, so nothing provider-specific reaches the domain.
 */
export type MailboxCapabilities = {
  readonly canModify: boolean;
  /** One sentence naming the fix, when `canModify` is false. */
  readonly reason?: string;
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

  /** Whether this connection may change the mailbox. Checked before anything is applied. */
  capabilities(): Promise<Result<MailboxCapabilities>>;

  listEmails(options: ListEmailsOptions): Promise<Result<EmailPage>>;

  getEmail(id: EmailId): Promise<Result<Email>>;

  /** Applies already-decided actions. Providers never decide anything themselves. */
  applyActions(id: EmailId, actions: readonly Action[]): Promise<Result<void>>;

  /** Reverses previously applied actions, for undo. */
  reverseActions(id: EmailId, actions: readonly Action[]): Promise<Result<void>>;

  ensureLabels(labels: readonly string[]): Promise<Result<void>>;
}
