import type { Email } from "../domain/email.js";
import type { AccountId, EmailId } from "../domain/ids.js";
import type { Result } from "../result.js";

export type SaveEmailsSummary = {
  readonly inserted: number;
  readonly updated: number;
};

export type ListStoredEmailsOptions = {
  readonly accountId: AccountId;
  readonly since?: Date;
  readonly limit?: number;
};

/**
 * The persistence surface Foundations needs: store what was fetched, read it back, remember how far
 * the last sync got. Decisions, actions and the audit log get their own ports in later specs.
 */
export interface EmailStore {
  saveEmails(emails: readonly Email[]): Promise<Result<SaveEmailsSummary>>;

  getEmail(id: EmailId): Promise<Result<Email | undefined>>;

  listEmails(options: ListStoredEmailsOptions): Promise<Result<readonly Email[]>>;

  countEmails(accountId: AccountId): Promise<Result<number>>;

  lastSyncAt(accountId: AccountId): Promise<Result<Date | undefined>>;

  recordSync(accountId: AccountId, at: Date): Promise<Result<void>>;
}
