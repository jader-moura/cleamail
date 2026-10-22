import {
  ACTION_OUTCOMES,
  ActionSchema,
  DecisionSchema,
  accountId as toAccountId,
  emailId as toEmailId,
  failure,
  ok,
  systemClock,
  type AccountId,
  type ActionOutcome,
  type Clock,
  type CompleteActionsInput,
  type Decision,
  type DecisionStore,
  type ListDecisionsOptions,
  type Result,
  type SaveDecisionInput,
  type StoredAction,
  type StoredDecision,
} from "@cleamail/core";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "../client.js";
import { actions, decisions, type ActionRow, type DecisionRow } from "../schema.js";

const DEFAULT_LIMIT = 200;

/**
 * Decisions and the actions taken from them.
 *
 * Rows are validated with Zod on the way out: a row written by an older version, or edited by hand,
 * must not reach the executor as if cleamail had planned it. A decision that cannot be read back is
 * reported rather than skipped, because a gap in this table is exactly what undo cannot afford.
 */
export class SqliteDecisionStore implements DecisionStore {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock = systemClock,
  ) {}

  async saveDecision(input: SaveDecisionInput): Promise<Result<StoredDecision>> {
    try {
      const { decision } = input;
      const at = input.appliedAt ?? this.clock.now();

      return this.db.transaction((tx) => {
        const inserted = tx
          .insert(decisions)
          .values({
            emailId: decision.emailId,
            accountId: decision.accountId,
            runId: input.runId,
            category: decision.classification?.category ?? null,
            importance: decision.classification?.importance ?? null,
            confidence: decision.classification?.confidence ?? null,
            reason: decision.classification?.reason ?? null,
            source: decision.classification?.source ?? null,
            ruleId: decision.classification?.ruleId ?? null,
            model: decision.classification?.model ?? null,
            reviewReason: decision.reviewReason ?? null,
            reviewDetail: decision.reviewDetail ?? null,
            actionsJson: JSON.stringify(decision.actions),
            policyVersion: decision.policyVersion,
            decidedAt: decision.decidedAt,
            appliedAt: input.appliedAt ?? null,
            dryRun: input.dryRun,
          })
          .returning({ id: decisions.id })
          .get();

        const rows = (input.actions ?? []).map((planned) => ({
          decisionId: inserted.id,
          emailId: decision.emailId,
          type: planned.action.type,
          payloadJson: JSON.stringify(planned.action),
          outcome: planned.outcome,
          appliedAt: at,
          error: planned.error ?? null,
        }));

        const storedActions =
          rows.length === 0 ? [] : tx.insert(actions).values(rows).returning().all();

        return ok({
          id: inserted.id,
          runId: input.runId,
          decision,
          dryRun: input.dryRun,
          ...(input.appliedAt === undefined ? {} : { appliedAt: input.appliedAt }),
          actions: storedActions.map((row) => toStoredAction(row)).filter(isDefined),
        });
      });
    } catch (cause) {
      return failure("store_failure", "Could not record the decision.", cause);
    }
  }

  async listDecisions(options: ListDecisionsOptions): Promise<Result<readonly StoredDecision[]>> {
    try {
      const conditions = [eq(decisions.accountId, options.accountId)];
      if (options.runId !== undefined) conditions.push(eq(decisions.runId, options.runId));
      if (options.emailId !== undefined) conditions.push(eq(decisions.emailId, options.emailId));

      const rows = this.db
        .select()
        .from(decisions)
        .where(and(...conditions))
        .orderBy(desc(decisions.id))
        .limit(options.limit ?? DEFAULT_LIMIT)
        .all();

      if (rows.length === 0) return ok([]);

      const actionRows = this.db
        .select()
        .from(actions)
        .where(
          inArray(
            actions.decisionId,
            rows.map((row) => row.id),
          ),
        )
        .all();

      const byDecision = new Map<number, StoredAction[]>();
      for (const row of actionRows) {
        const action = toStoredAction(row);
        if (action === undefined) {
          return failure(
            "store_failure",
            `Action ${String(row.id)} could not be read back, so this run cannot be undone safely.`,
          );
        }

        const list = byDecision.get(row.decisionId) ?? [];
        list.push(action);
        byDecision.set(row.decisionId, list);
      }

      const stored: StoredDecision[] = [];

      for (const row of rows) {
        const decision = toDecision(row);
        if (!decision.ok) return decision;

        stored.push({
          id: row.id,
          runId: row.runId,
          decision: decision.value,
          dryRun: row.dryRun,
          ...(row.appliedAt === null ? {} : { appliedAt: row.appliedAt }),
          actions: byDecision.get(row.id) ?? [],
        });
      }

      return ok(stored);
    } catch (cause) {
      return failure("store_failure", "Could not read the stored decisions.", cause);
    }
  }

  async completeActions(input: CompleteActionsInput): Promise<Result<number>> {
    if (input.actionIds.length === 0) return ok(0);

    try {
      return this.db.transaction((tx) => {
        const updated = tx
          .update(actions)
          .set({
            outcome: input.outcome,
            appliedAt: input.at,
            error: input.error ?? null,
          })
          .where(and(inArray(actions.id, [...input.actionIds]), eq(actions.outcome, "planned")))
          .returning({ id: actions.id })
          .all();

        // The decision is marked applied in the same transaction, so a row and its actions can
        // never disagree about whether anything happened to the mailbox.
        if (input.outcome === "applied" && updated.length > 0) {
          tx.update(decisions)
            .set({ appliedAt: input.at })
            .where(eq(decisions.id, input.decisionId))
            .run();
        }

        return ok(updated.length);
      });
    } catch (cause) {
      return failure("store_failure", "Could not record what was applied.", cause);
    }
  }

  async lastAppliedRunId(accountId: AccountId): Promise<Result<string | undefined>> {
    try {
      // The last run that really changed something, read off the action rows. `reversed` counts,
      // because that run did apply: it is how a second undo finds it and reports it was done.
      const row = this.db
        .select({ runId: decisions.runId })
        .from(decisions)
        .innerJoin(actions, eq(actions.decisionId, decisions.id))
        .where(
          and(
            eq(decisions.accountId, accountId),
            eq(decisions.dryRun, false),
            inArray(actions.outcome, ["applied", "reversed"]),
          ),
        )
        .orderBy(desc(decisions.id))
        .limit(1)
        .get();

      return ok(row?.runId);
    } catch (cause) {
      return failure("store_failure", "Could not find the last run.", cause);
    }
  }

  async markReversed(actionIds: readonly number[], at: Date): Promise<Result<number>> {
    if (actionIds.length === 0) return ok(0);

    try {
      // `isNull(reversedAt)` is the idempotence: undoing twice updates nothing the second time.
      const updated = this.db
        .update(actions)
        .set({ outcome: "reversed", reversedAt: at })
        .where(and(inArray(actions.id, [...actionIds]), isNull(actions.reversedAt)))
        .returning({ id: actions.id })
        .all();

      return ok(updated.length);
    } catch (cause) {
      return failure("store_failure", "Could not record the undo.", cause);
    }
  }
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

/** A row whose payload or outcome does not parse is dropped and reported by the caller. */
function toStoredAction(row: ActionRow): StoredAction | undefined {
  const action = ActionSchema.safeParse(JSON.parse(row.payloadJson));
  if (!action.success) return undefined;
  if (!isOutcome(row.outcome)) return undefined;

  return {
    id: row.id,
    decisionId: row.decisionId,
    emailId: toEmailId(row.emailId),
    action: action.data,
    outcome: row.outcome,
    at: row.appliedAt,
    ...(row.reversedAt === null ? {} : { reversedAt: row.reversedAt }),
    ...(row.error === null ? {} : { error: row.error }),
  };
}

function isOutcome(value: string): value is ActionOutcome {
  return (ACTION_OUTCOMES as readonly string[]).includes(value);
}

function toDecision(row: DecisionRow): Result<Decision> {
  const parsed = DecisionSchema.safeParse({
    emailId: row.emailId,
    accountId: row.accountId,
    ...(row.category === null
      ? {}
      : {
          classification: {
            category: row.category,
            importance: row.importance,
            confidence: row.confidence,
            reason: row.reason,
            source: row.source,
            ...(row.ruleId === null ? {} : { ruleId: row.ruleId }),
            ...(row.model === null ? {} : { model: row.model }),
          },
        }),
    ...(row.reviewReason === null ? {} : { reviewReason: row.reviewReason }),
    ...(row.reviewDetail === null ? {} : { reviewDetail: row.reviewDetail }),
    actions: JSON.parse(row.actionsJson) as unknown,
    policyVersion: row.policyVersion,
    decidedAt: row.decidedAt,
  });

  if (!parsed.success) {
    return failure(
      "store_failure",
      `Decision ${String(row.id)} is not readable, so cleamail will not act on it.`,
    );
  }

  return ok({ ...parsed.data, accountId: toAccountId(row.accountId) });
}
