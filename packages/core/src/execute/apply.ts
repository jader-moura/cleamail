import { isNoOp } from "../domain/action.js";
import type { Decision } from "../domain/decision.js";
import type { AccountId } from "../domain/ids.js";
import { silentLogger, type Logger } from "../ports/logger.js";
import type { AuditLog, DecisionStore } from "../ports/decision-store.js";
import type { MailProvider } from "../ports/mail-provider.js";
import { failure, ok, type ErrorCode, type Result } from "../result.js";

export type ExecuteDeps = {
  readonly provider: MailProvider;
  readonly decisions: DecisionStore;
  readonly audit: AuditLog;
  /** Groups everything this run did, so `undo --last` reverses a batch rather than an email. */
  readonly runId: string;
  /** Passed in, like the policy engine's clock, so a run and its rows agree on one moment. */
  readonly now: Date;
  readonly logger?: Logger;
};

export type ApplyInput = {
  readonly accountId: AccountId;
  readonly decisions: readonly Decision[];
  /**
   * Record what would happen and touch nothing.
   *
   * A dry run still writes decision rows, because the dashboard's first-run preview is the same
   * decisions seen before they were applied. No action rows are written: nothing was done to
   * reverse.
   */
  readonly dryRun?: boolean;
};

export type ApplySummary = {
  readonly runId: string;
  readonly dryRun: boolean;
  /** Emails whose mailbox state actually changed. */
  readonly emailsChanged: number;
  readonly applied: number;
  /** Planned actions that would have changed nothing, so they were never sent. */
  readonly skipped: number;
  readonly failed: number;
  /** Emails that could not be changed, with cleamail's words about why. */
  readonly failures: readonly { readonly emailId: string; readonly error: string }[];
};

/**
 * Errors that are about the mailbox rather than about one message.
 *
 * These fail identically for every email, so a run that hits one stops instead of writing the same
 * error three hundred times. Anything else is this message's problem: it is recorded and the run
 * carries on.
 */
const MAILBOX_WIDE: readonly ErrorCode[] = [
  "provider_auth",
  "provider_unavailable",
  "provider_rate_limited",
  "config_invalid",
];

/**
 * Applies decided actions and writes down what happened.
 *
 * It decides nothing. Every action here came from the policy engine, and this function's whole job
 * is to be exact: refuse a mailbox it may not change, never send an action that would change
 * nothing, record the before-state of everything it does send, and say plainly what failed.
 */
export async function applyDecisions(
  input: ApplyInput,
  deps: ExecuteDeps,
): Promise<Result<ApplySummary>> {
  const logger = deps.logger ?? silentLogger;
  const dryRun = input.dryRun === true;

  if (!dryRun) {
    const allowed = await ensureCanModify(input.accountId, deps);
    if (!allowed.ok) return allowed;

    const labels = await ensureLabels(input.decisions, deps);
    if (!labels.ok) return labels;
  }

  let emailsChanged = 0;
  let applied = 0;
  let skipped = 0;
  const failures: { emailId: string; error: string }[] = [];

  for (const decision of input.decisions) {
    const noOps = decision.actions.filter((action) => isNoOp(action));
    const pending = decision.actions.filter((action) => !isNoOp(action));

    skipped += noOps.length;

    if (dryRun) {
      const saved = await deps.decisions.saveDecision({
        decision,
        runId: deps.runId,
        dryRun: true,
      });
      if (!saved.ok) return saved;

      continue;
    }

    // Written down before anything is attempted. If this write fails nothing has been touched yet,
    // and if the process dies mid-run the planned rows say what was in flight. The other order
    // would allow a changed mailbox with no record, which is the one outcome undo cannot survive.
    const saved = await deps.decisions.saveDecision({
      decision,
      runId: deps.runId,
      dryRun: false,
      actions: [
        ...pending.map((action) => ({ action, outcome: "planned" as const })),
        ...noOps.map((action) => ({ action, outcome: "skipped" as const })),
      ],
    });
    if (!saved.ok) return saved;

    if (pending.length === 0) continue;

    const planned = saved.value.actions.filter((action) => action.outcome === "planned");
    const result = await deps.provider.applyActions(decision.emailId, pending);

    if (!result.ok) {
      logger.warn("Could not apply a decision", {
        emailId: decision.emailId,
        code: result.error.code,
      });

      const marked = await deps.decisions.completeActions({
        decisionId: saved.value.id,
        actionIds: planned.map((action) => action.id),
        outcome: "failed",
        at: deps.now,
        error: result.error.message,
      });
      if (!marked.ok) return marked;

      failures.push({ emailId: decision.emailId, error: result.error.message });

      await deps.audit.append({
        kind: "fail",
        emailId: decision.emailId,
        decisionId: saved.value.id,
        summary: `Could not change ${decision.emailId}: ${result.error.message}`,
        details: { runId: deps.runId, code: result.error.code },
      });

      if (MAILBOX_WIDE.includes(result.error.code)) {
        // Every remaining email would fail the same way, so the run stops here with what it did.
        return failure(
          result.error.code,
          `The run stopped at ${decision.emailId}: ${result.error.message}`,
          result.error.cause,
        );
      }

      continue;
    }

    const marked = await deps.decisions.completeActions({
      decisionId: saved.value.id,
      actionIds: planned.map((action) => action.id),
      outcome: "applied",
      at: deps.now,
    });
    if (!marked.ok) return marked;

    emailsChanged += 1;
    applied += pending.length;
  }

  const summary: ApplySummary = {
    runId: deps.runId,
    dryRun,
    emailsChanged,
    applied,
    skipped,
    failed: failures.length,
    failures,
  };

  await deps.audit.append({
    kind: dryRun ? "decide" : "apply",
    summary: dryRun
      ? `Previewed ${String(input.decisions.length)} decision(s), changed nothing`
      : `Applied ${String(applied)} action(s) to ${String(emailsChanged)} email(s)`,
    details: {
      runId: deps.runId,
      decisions: input.decisions.length,
      applied,
      skipped,
      failed: failures.length,
    },
  });

  return ok(summary);
}

async function ensureCanModify(
  accountId: AccountId,
  deps: ExecuteDeps,
): Promise<Result<undefined>> {
  const capabilities = await deps.provider.capabilities();
  if (!capabilities.ok) return capabilities;

  if (capabilities.value.canModify) return ok(undefined);

  const reason =
    capabilities.value.reason ??
    "This mailbox is connected read-only. Run `cleamail init` again without --read-only to let it change labels.";

  // Written down even though nothing happened: a user who wonders why their run did nothing should
  // find the answer in the log rather than only in the terminal they have since closed.
  await deps.audit.append({
    kind: "refuse",
    summary: `Refused to apply anything: ${reason}`,
    details: { runId: deps.runId, accountId },
  });

  return failure("unsupported_operation", reason);
}

/** Creates the labels the plans need, once per run, before anything is applied. */
async function ensureLabels(
  decisions: readonly Decision[],
  deps: ExecuteDeps,
): Promise<Result<undefined>> {
  const labels = new Set<string>();

  for (const decision of decisions) {
    for (const action of decision.actions) {
      if (action.type === "label" && !isNoOp(action)) labels.add(action.label);
    }
  }

  if (labels.size === 0) return ok(undefined);

  const ensured = await deps.provider.ensureLabels([...labels]);
  if (!ensured.ok) return ensured;

  return ok(undefined);
}
