import type { CliDeps } from "../deps.js";
import { emailId, undoRun, type UndoSummary } from "../ports.js";
import { EXIT } from "../exit.js";
import { connect } from "./account.js";

export type UndoOptions = {
  /** A run id, from the audit log. Defaults to the last run that applied anything. */
  readonly run?: string;
  /** One message within that run, for putting a single email back. */
  readonly email?: string;
};

/**
 * Puts the mailbox back the way it was.
 *
 * Undo reads the recorded actions and reverses them from the state each one found, so it never has
 * to work out what a message looked like before. Running it twice is safe: a row already reversed
 * is left alone rather than re-applied the other way.
 */
export async function undoCommand(deps: CliDeps, options: UndoOptions = {}): Promise<number> {
  const connected = await connect(deps);
  if (!connected.ok) {
    deps.err(connected.error.message);

    return EXIT.failure;
  }

  const { account, provider } = connected.value;
  const now = deps.clock.now();

  const result = await undoRun(
    {
      accountId: account.id,
      ...(options.run === undefined ? {} : { runId: options.run }),
      ...(options.email === undefined ? {} : { emailId: emailId(options.email) }),
    },
    {
      provider,
      decisions: deps.store.decisions,
      audit: deps.store.audit,
      runId: `undo-${now.toISOString()}`,
      now,
    },
  );

  if (!result.ok) {
    deps.err(result.error.message);

    return EXIT.failure;
  }

  for (const line of undoLines(result.value)) deps.out(line);

  return result.value.failures.length === 0 ? EXIT.ok : EXIT.failure;
}

function undoLines(summary: UndoSummary): readonly string[] {
  const lines = [`Undid run ${summary.runId}`, ""];

  if (summary.reversed === 0 && summary.alreadyReversed > 0) {
    lines.push("  Nothing to do: this run had already been undone.");
  } else {
    lines.push(
      `  restored   ${String(summary.emailsRestored)} email(s), ${String(summary.reversed)} action(s)`,
    );
  }

  if (summary.alreadyReversed > 0 && summary.reversed > 0) {
    lines.push(`  already    ${String(summary.alreadyReversed)} action(s) were undone before`);
  }

  if (summary.failures.length > 0) {
    lines.push(`  failed     ${String(summary.failures.length)} email(s)`);
    for (const failure of summary.failures) {
      lines.push(`             ${failure.emailId}: ${failure.error}`);
    }
    lines.push("", "  Run it again to retry the ones that failed.");
  }

  lines.push("");

  return lines;
}
