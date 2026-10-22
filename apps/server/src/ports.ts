/**
 * One place to re-export what the routes use, so a route file imports from here rather than
 * reaching into another package directly.
 */
export type {
  AccountId,
  ActionOutcome,
  Clock,
  DomainError,
  EmailId,
  MailAccount,
  MailProvider,
  Result,
  StoredAction,
  StoredAuditEntry,
  StoredDecision,
  UndoSummary,
} from "@cleamail/core";

export { emailId, explainDecision, failure, ok, undoRun } from "@cleamail/core";

export type { Store } from "@cleamail/store";
