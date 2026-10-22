import type { Action } from "../domain/action.js";
import type { AccountId, EmailId } from "../domain/ids.js";
import { silentLogger } from "../ports/logger.js";
import type { StoredAction } from "../ports/decision-store.js";
import { failure, ok, type Result } from "../result.js";
import type { ExecuteDeps } from "./apply.js";

export type UndoInput = {
  readonly accountId: AccountId;
  /** Defaults to the last run that applied something, which is what `undo --last` means. */
  readonly runId?: string;
  /** Narrows the undo to one email within that run. */
  readonly emailId?: EmailId;
};

export type UndoSummary = {
  readonly runId: string;
  readonly emailsRestored: number;
  readonly reversed: number;
  /** Rows that were already reversed, which is how a second undo reports doing nothing. */
  readonly alreadyReversed: number;
  readonly failures: readonly { readonly emailId: string; readonly error: string }[];
};

/**
 * Puts a mailbox back the way it was.
 *
 * Every action row carries the state it found, so undo reverses from the record rather than
 * guessing from the mailbox as it is now. Only rows that were actually applied are reversed, and a
 * row that has already been reversed is left alone, so running undo twice does not re-star
 * something the user has since unstarred.
 */
export async function undoRun(input: UndoInput, deps: ExecuteDeps): Promise<Result<UndoSummary>> {
  const logger = deps.logger ?? silentLogger;

  const runId = input.runId ?? (await lastRunId(input.accountId, deps));
  if (runId === undefined) {
    return failure("not_found", "There is nothing to undo yet.");
  }

  const allowed = await deps.provider.capabilities();
  if (!allowed.ok) return allowed;
  if (!allowed.value.canModify) {
    return failure(
      "unsupported_operation",
      allowed.value.reason ??
        "This mailbox is connected read-only, so there is nothing cleamail can put back.",
    );
  }

  const stored = await deps.decisions.listDecisions({
    accountId: input.accountId,
    runId,
    ...(input.emailId === undefined ? {} : { emailId: input.emailId }),
  });
  if (!stored.ok) return stored;

  let emailsRestored = 0;
  let reversed = 0;
  let alreadyReversed = 0;
  const failures: { emailId: string; error: string }[] = [];

  for (const decision of stored.value) {
    // `reversed` rows were applied once too, which is what makes a second undo report that it
    // found work already done rather than finding nothing at all.
    const done = decision.actions.filter(
      (action) => action.outcome === "applied" || action.outcome === "reversed",
    );
    const pending = done.filter(
      (action) => action.outcome === "applied" && action.reversedAt === undefined,
    );

    alreadyReversed += done.length - pending.length;

    if (pending.length === 0) continue;

    const result = await deps.provider.reverseActions(
      decision.decision.emailId,
      pending.map((stored_) => stored_.action),
    );

    if (!result.ok) {
      logger.warn("Could not undo a decision", {
        emailId: decision.decision.emailId,
        code: result.error.code,
      });

      failures.push({ emailId: decision.decision.emailId, error: result.error.message });

      await deps.audit.append({
        kind: "fail",
        emailId: decision.decision.emailId,
        summary: `Could not undo ${decision.decision.emailId}: ${result.error.message}`,
        details: { runId, code: result.error.code },
      });

      continue;
    }

    // Marked only after the provider agreed, so a failed undo can be tried again.
    const marked = await deps.decisions.markReversed(ids(pending), deps.now);
    if (!marked.ok) return marked;

    emailsRestored += 1;
    reversed += pending.length;
  }

  await deps.audit.append({
    kind: "undo",
    summary: `Undid ${String(reversed)} action(s) on ${String(emailsRestored)} email(s)`,
    details: { runId, reversed, alreadyReversed, failed: failures.length },
  });

  return ok({ runId, emailsRestored, reversed, alreadyReversed, failures });
}

async function lastRunId(accountId: AccountId, deps: ExecuteDeps): Promise<string | undefined> {
  const last = await deps.decisions.lastAppliedRunId(accountId);

  return last.ok ? last.value : undefined;
}

function ids(actions: readonly StoredAction[]): readonly number[] {
  return actions.map((action) => action.id);
}

/** The actions an undo would reverse, for a preview that promises exactly what it will do. */
export function reversible(actions: readonly StoredAction[]): readonly Action[] {
  return actions
    .filter((action) => action.outcome === "applied" && action.reversedAt === undefined)
    .map((action) => action.action);
}
