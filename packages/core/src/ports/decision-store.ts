import type { Action } from "../domain/action.js";
import type { Decision } from "../domain/decision.js";
import type { AccountId, EmailId } from "../domain/ids.js";
import type { Result } from "../result.js";

/**
 * How one action ended up.
 *
 * `planned` is written before the provider is called and replaced by the real outcome afterwards,
 * so a write that fails, or a process that is killed, cannot leave a changed mailbox with no record
 * of what was done to it.
 *
 * `skipped` is a real outcome, not a failure: the policy engine plans actions without looking at
 * the mailbox, so an action that would change nothing arrives here and is dropped. Recording it as
 * applied would make the audit log claim work it never did.
 */
export const ACTION_OUTCOMES = ["planned", "applied", "skipped", "failed", "reversed"] as const;
export type ActionOutcome = (typeof ACTION_OUTCOMES)[number];

/** One action as it was stored: what it was, what happened to it, and when. */
export type StoredAction = {
  readonly id: number;
  readonly decisionId: number;
  readonly emailId: EmailId;
  readonly action: Action;
  readonly outcome: ActionOutcome;
  readonly at: Date;
  readonly reversedAt?: Date;
  /** Why it failed, in cleamail's words. Never email content. */
  readonly error?: string;
};

/** One decision as it was stored, with the actions that were planned from it. */
export type StoredDecision = {
  readonly id: number;
  readonly runId: string;
  readonly decision: Decision;
  readonly dryRun: boolean;
  readonly appliedAt?: Date;
  readonly actions: readonly StoredAction[];
};

export type SaveDecisionInput = {
  readonly decision: Decision;
  /** Groups everything one run did, so undo can reverse a batch rather than an email. */
  readonly runId: string;
  /** A dry run stores the decision and no action rows: it is a record of what was going to happen. */
  readonly dryRun: boolean;
  readonly actions?: readonly {
    readonly action: Action;
    readonly outcome: ActionOutcome;
    readonly error?: string;
  }[];
  readonly appliedAt?: Date;
};

export type CompleteActionsInput = {
  readonly decisionId: number;
  readonly actionIds: readonly number[];
  readonly outcome: Extract<ActionOutcome, "applied" | "failed">;
  readonly at: Date;
  /** Why it failed, in cleamail's words. Never email content. */
  readonly error?: string;
};

export type ListDecisionsOptions = {
  readonly accountId: AccountId;
  readonly runId?: string;
  readonly emailId?: EmailId;
  readonly limit?: number;
};

/**
 * Where decisions and the actions taken from them are kept.
 *
 * Reads validate on the way out: the database is external input like any other, and a row written
 * by an older version must not reach the executor unchecked.
 */
export interface DecisionStore {
  saveDecision(input: SaveDecisionInput): Promise<Result<StoredDecision>>;

  /** Most recent first, so the CLI and the dashboard both read the same order. */
  listDecisions(options: ListDecisionsOptions): Promise<Result<readonly StoredDecision[]>>;

  /**
   * Replaces the outcome of action rows once the provider has answered.
   *
   * Called with `applied` or `failed` right after the attempt. Marking the decision applied is part
   * of the same call, so the row and its actions cannot disagree about whether anything happened.
   */
  completeActions(input: CompleteActionsInput): Promise<Result<number>>;

  /** The run id of the last run that actually applied something, for `undo --last`. */
  lastAppliedRunId(accountId: AccountId): Promise<Result<string | undefined>>;

  /** Marks action rows reversed. Already-reversed rows are left alone, so undo is idempotent. */
  markReversed(actionIds: readonly number[], at: Date): Promise<Result<number>>;
}

export const AUDIT_KINDS = ["fetch", "decide", "apply", "skip", "fail", "undo", "refuse"] as const;
export type AuditKind = (typeof AUDIT_KINDS)[number];

export type AuditEntry = {
  readonly kind: AuditKind;
  readonly summary: string;
  readonly emailId?: EmailId;
  readonly decisionId?: number;
  /** Ids, counts, categories and reasons only. Never a subject, a sender or a body. */
  readonly details?: Readonly<Record<string, unknown>>;
};

export type StoredAuditEntry = AuditEntry & {
  readonly id: number;
  readonly at: Date;
};

/**
 * The record of what cleamail did, in words a user could read out loud.
 *
 * This is the table the dashboard's "Cleaned" list and its undo button are built on, so it is
 * written even when nothing was applied: a run that refused to act is a thing the user needs to be
 * able to find afterwards.
 */
export interface AuditLog {
  append(entry: AuditEntry): Promise<Result<StoredAuditEntry>>;

  list(options?: { readonly limit?: number }): Promise<Result<readonly StoredAuditEntry[]>>;
}
