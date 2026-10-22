import type {
  Action,
  ActionOutcome,
  DomainError,
  Email,
  StoredAction,
  StoredAuditEntry,
  StoredDecision,
} from "@cleamail/core";

/**
 * The shapes the API answers with.
 *
 * Written out rather than derived from the store's rows on purpose: what the dashboard sees is a
 * decision, not a side effect of the schema. A column added to `decisions` next month must not
 * appear in the API because nobody stopped it.
 *
 * A decision shape carries no subject, sender or body. The mail itself is a separate shape with a
 * separate route, so a view that only lists what happened cannot accidentally ship an inbox, and
 * the one route that does serve mail is the one to look at when asking what the dashboard can see.
 *
 * Serving it at all is safe because loopback HTTP to the user's own browser never leaves the
 * machine. What must never carry content is a log line, the audit log, or anything addressed
 * outside this machine.
 */

export type ApiError = {
  readonly error: {
    readonly code: DomainError["code"] | "bad_request" | "not_allowed";
    readonly message: string;
  };
};

export type ApiAction = {
  readonly id: number;
  readonly type: string;
  readonly outcome: ActionOutcome;
  readonly at: string;
  readonly reversedAt?: string;
  readonly error?: string;
  /** True when undoing this run would send this action. */
  readonly reversible: boolean;
};

export type ApiDecision = {
  readonly id: number;
  readonly runId: string;
  readonly emailId: string;
  readonly category?: string;
  readonly confidence?: number;
  /** The one sentence shown next to the decision, from the classification or from cleamail. */
  readonly explanation: string;
  readonly reviewReason?: string;
  readonly dryRun: boolean;
  readonly decidedAt: string;
  readonly appliedAt?: string;
  readonly actions: readonly ApiAction[];
};

export type ApiAuditEntry = {
  readonly id: number;
  readonly at: string;
  readonly kind: string;
  readonly summary: string;
  readonly emailId?: string;
  readonly decisionId?: number;
  readonly details?: Readonly<Record<string, unknown>>;
};

/**
 * One email, as little of it as a list needs.
 *
 * The body and the snippet are not here. A row in the dashboard shows who it is from, what it is
 * called and when it arrived; anything more is the mail client's job, and cleamail is not one.
 */
export type ApiEmail = {
  readonly id: string;
  readonly subject: string;
  readonly from: string;
  readonly fromName?: string;
  readonly receivedAt: string;
  readonly isRead: boolean;
  readonly isStarred: boolean;
  readonly isInInbox: boolean;
  readonly labels: readonly string[];
};

export type ApiStatus = {
  readonly version: string;
  readonly database: string;
  readonly model: string;
  readonly mailbox?: {
    readonly address: string;
    readonly kind: string;
    /**
     * Absent when cleamail could not find out, which is not the same as read-only.
     *
     * The dashboard offers to act on `true` and explains read-only on `false`. On neither it says
     * what is missing instead, because "re-run init without --read-only" is the wrong advice for a
     * keychain that has no OAuth client in it.
     */
    readonly canModify?: boolean;
    readonly messages: number;
    readonly lastSyncAt?: string;
  };
};

export type ApiApplyResult = {
  readonly runId: string;
  readonly emailsChanged: number;
  readonly applied: number;
  readonly skipped: number;
  readonly failures: readonly { readonly emailId: string; readonly error: string }[];
};

export type ApiUndoResult = {
  readonly runId: string;
  readonly emailsRestored: number;
  readonly reversed: number;
  readonly alreadyReversed: number;
  readonly failures: readonly { readonly emailId: string; readonly error: string }[];
};

export function toApiEmail(email: Email): ApiEmail {
  return {
    id: email.id,
    subject: email.subject,
    from: email.from.address,
    receivedAt: email.receivedAt.toISOString(),
    isRead: email.isRead,
    isStarred: email.isStarred,
    isInInbox: email.isInInbox,
    labels: email.providerLabels,
    ...(email.from.name === undefined ? {} : { fromName: email.from.name }),
  };
}

export function toApiAction(action: StoredAction): ApiAction {
  return {
    id: action.id,
    type: action.action.type,
    outcome: action.outcome,
    at: action.at.toISOString(),
    reversible: action.outcome === "applied" && action.reversedAt === undefined,
    ...(action.reversedAt === undefined ? {} : { reversedAt: action.reversedAt.toISOString() }),
    ...(action.error === undefined ? {} : { error: action.error }),
  };
}

export function toApiDecision(stored: StoredDecision, explanation: string): ApiDecision {
  const { decision } = stored;

  return {
    id: stored.id,
    runId: stored.runId,
    emailId: decision.emailId,
    explanation,
    dryRun: stored.dryRun,
    decidedAt: decision.decidedAt.toISOString(),
    ...(decision.classification === undefined
      ? {}
      : {
          category: decision.classification.category,
          confidence: decision.classification.confidence,
        }),
    ...(decision.reviewReason === undefined ? {} : { reviewReason: decision.reviewReason }),
    ...(stored.appliedAt === undefined ? {} : { appliedAt: stored.appliedAt.toISOString() }),
    // A preview has no action rows, because nothing was done. Its plan is on the decision itself,
    // and it is the whole point of a preview: without this the dashboard shows a first run as
    // "nothing would happen", which is the one thing it must never say wrongly.
    actions:
      stored.actions.length === 0
        ? decision.actions.map((action, index) => plannedAction(action, index, decision.decidedAt))
        : stored.actions.map((action) => toApiAction(action)),
  };
}

/** One action the engine planned, which nothing has tried yet. */
function plannedAction(action: Action, index: number, at: Date): ApiAction {
  return {
    // Negative, so it cannot be mistaken for a row id the undo path could act on.
    id: -(index + 1),
    type: action.type,
    outcome: "planned",
    at: at.toISOString(),
    reversible: false,
  };
}

export function toApiAuditEntry(entry: StoredAuditEntry): ApiAuditEntry {
  return {
    id: entry.id,
    at: entry.at.toISOString(),
    kind: entry.kind,
    summary: entry.summary,
    ...(entry.emailId === undefined ? {} : { emailId: entry.emailId }),
    ...(entry.decisionId === undefined ? {} : { decisionId: entry.decisionId }),
    ...(entry.details === undefined ? {} : { details: entry.details }),
  };
}
