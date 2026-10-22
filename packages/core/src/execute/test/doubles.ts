import type { Action } from "../../domain/action.js";
import { accountId as toAccountId, type AccountId, type EmailId } from "../../domain/ids.js";
import type {
  AuditEntry,
  AuditLog,
  CompleteActionsInput,
  DecisionStore,
  ListDecisionsOptions,
  SaveDecisionInput,
  StoredAction,
  StoredAuditEntry,
  StoredDecision,
} from "../../ports/decision-store.js";
import type {
  EmailPage,
  ListEmailsOptions,
  MailAccount,
  MailboxCapabilities,
  MailProvider,
  MailProviderKind,
} from "../../ports/mail-provider.js";
import { failure, ok, type DomainError, type Email, type Result } from "../../index.js";

export const TEST_ACCOUNT_ID: AccountId = toAccountId("acct-1");

export type Applied = {
  readonly emailId: EmailId;
  readonly actions: readonly Action[];
  readonly direction: "apply" | "reverse";
};

/**
 * A mailbox that records what it was asked to do.
 *
 * `core` has no dependencies, so the executor is tested against this rather than against the fake
 * in `providers`. It records calls instead of state, because what matters here is exactly which
 * actions reached the provider and which never did.
 */
export class RecordingMailbox implements MailProvider {
  readonly kind: MailProviderKind = "gmail";
  readonly calls: Applied[] = [];
  readonly ensured: string[][] = [];

  constructor(
    private readonly options: {
      readonly canModify?: boolean;
      /** Refuse without saying why, so the executor's own sentence is exercised. */
      readonly silentRefusal?: boolean;
      readonly failCapabilities?: DomainError;
      readonly failWith?: Readonly<Record<string, DomainError>>;
      /** Fails only the undo, which is how a retry-able undo failure is exercised. */
      readonly failReverseWith?: Readonly<Record<string, DomainError>>;
      readonly failEnsureLabels?: DomainError;
    } = {},
  ) {}

  account(): Promise<Result<MailAccount>> {
    return Promise.resolve(
      ok({ id: TEST_ACCOUNT_ID, kind: this.kind, address: "user@example.com" }),
    );
  }

  capabilities(): Promise<Result<MailboxCapabilities>> {
    if (this.options.failCapabilities !== undefined) {
      return Promise.resolve({ ok: false, error: this.options.failCapabilities });
    }

    if (this.options.silentRefusal === true) return Promise.resolve(ok({ canModify: false }));

    return Promise.resolve(
      ok(
        this.options.canModify === false
          ? { canModify: false, reason: "This mailbox is connected read-only." }
          : { canModify: true },
      ),
    );
  }

  listEmails(_options: ListEmailsOptions): Promise<Result<EmailPage>> {
    return Promise.resolve(ok({ emails: [] as readonly Email[] }));
  }

  getEmail(id: EmailId): Promise<Result<Email>> {
    return Promise.resolve(failure("not_found", `No message ${id}.`));
  }

  applyActions(id: EmailId, actions: readonly Action[]): Promise<Result<void>> {
    return Promise.resolve(this.record(id, actions, "apply"));
  }

  reverseActions(id: EmailId, actions: readonly Action[]): Promise<Result<void>> {
    return Promise.resolve(this.record(id, actions, "reverse"));
  }

  ensureLabels(labels: readonly string[]): Promise<Result<void>> {
    if (this.options.failEnsureLabels !== undefined) {
      return Promise.resolve({ ok: false, error: this.options.failEnsureLabels });
    }

    this.ensured.push([...labels]);

    return Promise.resolve(ok(undefined));
  }

  private record(
    id: EmailId,
    actions: readonly Action[],
    direction: "apply" | "reverse",
  ): Result<void> {
    const scripted =
      direction === "reverse"
        ? (this.options.failReverseWith?.[id] ?? this.options.failWith?.[id])
        : this.options.failWith?.[id];
    if (scripted !== undefined) return { ok: false, error: scripted };

    this.calls.push({ emailId: id, actions, direction });

    return ok(undefined);
  }
}

/** An in-memory {@link DecisionStore}, enough to exercise the executor and undo. */
export class MemoryDecisionStore implements DecisionStore {
  private nextDecisionId = 1;
  private nextActionId = 1;
  private readonly rows: StoredDecision[] = [];

  constructor(
    private readonly failSaveWith?: DomainError,
    private readonly failCompleteWith?: DomainError,
  ) {}

  saveDecision(input: SaveDecisionInput): Promise<Result<StoredDecision>> {
    if (this.failSaveWith !== undefined) {
      return Promise.resolve({ ok: false, error: this.failSaveWith });
    }

    const id = this.nextDecisionId++;

    const actions: StoredAction[] = (input.actions ?? []).map((planned) => ({
      id: this.nextActionId++,
      decisionId: id,
      emailId: input.decision.emailId,
      action: planned.action,
      outcome: planned.outcome,
      at: input.appliedAt ?? input.decision.decidedAt,
      ...(planned.error === undefined ? {} : { error: planned.error }),
    }));

    const stored: StoredDecision = {
      id,
      runId: input.runId,
      decision: input.decision,
      dryRun: input.dryRun,
      ...(input.appliedAt === undefined ? {} : { appliedAt: input.appliedAt }),
      actions,
    };

    this.rows.push(stored);

    return Promise.resolve(ok(stored));
  }

  listDecisions(options: ListDecisionsOptions): Promise<Result<readonly StoredDecision[]>> {
    const matching = this.rows
      .filter((row) => row.decision.accountId === options.accountId)
      .filter((row) => options.runId === undefined || row.runId === options.runId)
      .filter((row) => options.emailId === undefined || row.decision.emailId === options.emailId)
      .reverse();

    return Promise.resolve(ok(matching));
  }

  completeActions(input: CompleteActionsInput): Promise<Result<number>> {
    if (this.failCompleteWith !== undefined) {
      return Promise.resolve({ ok: false, error: this.failCompleteWith });
    }

    let changed = 0;

    for (const [index, row] of this.rows.entries()) {
      if (row.id !== input.decisionId) continue;

      const actions = row.actions.map((action) => {
        if (!input.actionIds.includes(action.id)) return action;

        changed += 1;

        return {
          ...action,
          outcome: input.outcome,
          at: input.at,
          ...(input.error === undefined ? {} : { error: input.error }),
        };
      });

      this.rows[index] = {
        ...row,
        actions,
        ...(input.outcome === "applied" ? { appliedAt: input.at } : {}),
      };
    }

    return Promise.resolve(ok(changed));
  }

  lastAppliedRunId(accountId: AccountId): Promise<Result<string | undefined>> {
    // The last run that really changed something: a row with an action that was applied, or one
    // that has since been reversed, which is how a second undo finds the run and reports it.
    const applied = this.rows.filter(
      (row) =>
        row.decision.accountId === accountId &&
        !row.dryRun &&
        row.actions.some((action) => action.outcome === "applied" || action.outcome === "reversed"),
    );

    return Promise.resolve(ok(applied.at(-1)?.runId));
  }

  markReversed(actionIds: readonly number[], at: Date): Promise<Result<number>> {
    let changed = 0;

    for (const [index, row] of this.rows.entries()) {
      const actions = row.actions.map((action) => {
        if (!actionIds.includes(action.id) || action.reversedAt !== undefined) return action;

        changed += 1;

        return { ...action, outcome: "reversed" as const, reversedAt: at };
      });

      this.rows[index] = { ...row, actions };
    }

    return Promise.resolve(ok(changed));
  }

  /** Test helper: every stored row, oldest first. */
  all(): readonly StoredDecision[] {
    return this.rows;
  }
}

export class MemoryAuditLog implements AuditLog {
  private nextId = 1;
  readonly entries: StoredAuditEntry[] = [];

  append(entry: AuditEntry): Promise<Result<StoredAuditEntry>> {
    const stored: StoredAuditEntry = {
      ...entry,
      id: this.nextId++,
      at: new Date("2026-10-02T09:00:00.000Z"),
    };

    this.entries.push(stored);

    return Promise.resolve(ok(stored));
  }

  list(options: { readonly limit?: number } = {}): Promise<Result<readonly StoredAuditEntry[]>> {
    const newestFirst = [...this.entries].reverse();

    return Promise.resolve(
      ok(options.limit === undefined ? newestFirst : newestFirst.slice(0, options.limit)),
    );
  }

  kinds(): readonly string[] {
    return this.entries.map((entry) => entry.kind);
  }
}
