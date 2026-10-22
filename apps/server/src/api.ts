import type {
  ActionOutcome,
  DomainError,
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
 * No subject, sender or body appears in any shape here, and none may be added. The dashboard shows
 * the mail by reading it from the store on the machine it is running on; the API carries decisions.
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

export type ApiStatus = {
  readonly version: string;
  readonly database: string;
  readonly model: string;
  readonly mailbox?: {
    readonly address: string;
    readonly kind: string;
    readonly canModify: boolean;
    readonly messages: number;
    readonly lastSyncAt?: string;
  };
};

export type ApiUndoResult = {
  readonly runId: string;
  readonly emailsRestored: number;
  readonly reversed: number;
  readonly alreadyReversed: number;
  readonly failures: readonly { readonly emailId: string; readonly error: string }[];
};

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
    actions: stored.actions.map((action) => toApiAction(action)),
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
