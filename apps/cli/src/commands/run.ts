import { classifyEmails } from "@cleamail/core";
import type { CliDeps } from "../deps.js";
import {
  DEFAULT_POLICY_SETTINGS,
  applyDecisions,
  type ApplySummary,
  type Email,
} from "../ports.js";
import { formatReport, pair } from "../report.js";
import { describeWindow, parseSince } from "../since.js";
import { EXIT } from "../exit.js";
import { connect } from "./account.js";

export type RunOptions = {
  readonly since: string;
  readonly max: number;
  /** When false, the run stops after fetching and says why it went no further. */
  readonly classify: boolean;
  /** Print the decisions without the subjects, senders or reasons they came from. */
  readonly redact?: boolean;
  /**
   * Apply the plan instead of only printing it.
   *
   * Off by default, and the only difference between looking and acting. The report is printed
   * first either way, so a user sees what is about to happen even in the same run that does it.
   */
  readonly apply?: boolean;
};

/**
 * Pages are bounded by the `after:` term in the query, so this cap only guards against a runaway
 * loop if a provider ever keeps handing out page tokens.
 */
const MAX_PAGES = 50;

/**
 * Fetches recent mail, classifies it, and prints the dry-run report.
 *
 * Without `--apply` nothing in the mailbox is touched: the policy engine plans the actions, the
 * report prints them, and the decisions are recorded as a preview. With `--apply` the same plan is
 * carried out and every action is written down so `cleamail undo` can reverse it.
 */
export async function runCommand(deps: CliDeps, options: RunOptions): Promise<number> {
  const now = deps.clock.now();

  const since = parseSince(options.since, now);
  if (!since.ok) {
    deps.err(since.error.message);

    return EXIT.usage;
  }

  const connected = await connect(deps);
  if (!connected.ok) {
    deps.err(connected.error.message);

    return EXIT.failure;
  }

  const { account, provider } = connected.value;

  deps.out(`Fetching ${describeWindow(since.value, now)} from ${account.address}`);

  let pageToken: string | undefined;
  let pages = 0;
  let fetched = 0;
  let inserted = 0;
  let updated = 0;

  do {
    const page = await provider.listEmails({
      since: since.value,
      maxResults: options.max,
      ...(pageToken === undefined ? {} : { pageToken }),
    });

    if (!page.ok) {
      deps.err(`Could not fetch mail: ${page.error.message}`);

      return EXIT.failure;
    }

    const emails: Email[] = [...page.value.emails];
    fetched += emails.length;

    const saved = await deps.store.emails.saveEmails(emails);
    if (!saved.ok) {
      deps.err(`Could not store mail: ${saved.error.message}`);

      return EXIT.failure;
    }

    inserted += saved.value.inserted;
    updated += saved.value.updated;
    pageToken = page.value.nextPageToken;
    pages += 1;
  } while (pageToken !== undefined && pages < MAX_PAGES);

  const recorded = await deps.store.emails.recordSync(account.id, now);
  if (!recorded.ok) {
    deps.err(`Could not record the sync time: ${recorded.error.message}`);

    return EXIT.failure;
  }

  deps.out("");
  deps.out(`  fetched   ${fetched}`);
  deps.out(`  new       ${inserted}`);
  deps.out(`  updated   ${updated}`);
  deps.out("");

  if (!options.classify) {
    deps.out("Skipped classification. Run without --no-classify to see the report.");

    return EXIT.ok;
  }

  const stored = await deps.store.emails.listEmails({
    accountId: account.id,
    since: since.value,
    limit: options.max,
  });

  if (!stored.ok) {
    deps.err(`Could not read the stored mail: ${stored.error.message}`);

    return EXIT.failure;
  }

  if (stored.value.length === 0) {
    deps.out("No mail in that window, so there is nothing to classify.");

    return EXIT.ok;
  }

  const classifier = deps.makeClassifier();
  if (!classifier.ok) {
    deps.err(classifier.error.message);

    return EXIT.failure;
  }

  deps.out(`Classifying ${stored.value.length} email(s) with ${deps.classifierModel}`);
  deps.out("The first one is slow while the model loads.");
  deps.out("");

  // The defaults until SPEC-016 stores them. The same object sets the threshold the pipeline
  // classifies by and the policy the report asks about, so what the run shows is what it did.
  const settings = DEFAULT_POLICY_SETTINGS;

  const outcomes = await classifyEmails(stored.value, {
    classifier: classifier.value,
    context: { accountAddress: account.address },
    confidenceThreshold: settings.confidenceThreshold,
    onProgress: (done, total) => {
      // Overwriting one line keeps a 200-email run from scrolling the report away.
      deps.progress(`  ${String(done)}/${String(total)}`);
    },
  });

  deps.progress("");

  if (!outcomes.ok) {
    deps.err(`Could not classify: ${outcomes.error.message}`);

    return EXIT.failure;
  }

  const reportInput = {
    emails: stored.value,
    outcomes: outcomes.value,
    model: deps.classifierModel,
    settings,
    now,
    redact: options.redact === true,
    applying: options.apply === true,
  };

  for (const line of formatReport(reportInput)) {
    deps.out(line);
  }

  // The same decisions the report just printed, applied or recorded as a preview. `decide` is pure,
  // so pairing twice cannot produce a different plan from the one the user was shown.
  const decisions = pair(reportInput).map((pairing) => pairing.decision);

  const executed = await applyDecisions(
    {
      accountId: account.id,
      decisions,
      ...(options.apply === true ? {} : { dryRun: true }),
    },
    {
      provider,
      decisions: deps.store.decisions,
      audit: deps.store.audit,
      // The moment the run started, which makes the audit log and `undo --last` readable.
      runId: `run-${now.toISOString()}`,
      now,
    },
  );

  if (!executed.ok) {
    deps.out("");
    deps.err(executed.error.message);

    return EXIT.failure;
  }

  for (const line of appliedLines(executed.value)) deps.out(line);

  return EXIT.ok;
}

/** What actually happened, in counts. Printed after the report, and only when something was done. */
function appliedLines(summary: ApplySummary): readonly string[] {
  if (summary.dryRun) return [];

  const lines = [
    "applied",
    "",
    `  changed    ${String(summary.emailsChanged)} email(s), ${String(summary.applied)} action(s)`,
  ];

  if (summary.skipped > 0) {
    lines.push(`  skipped    ${String(summary.skipped)} action(s) that would change nothing`);
  }

  if (summary.failed > 0) {
    lines.push(`  failed     ${String(summary.failed)} email(s)`);
    for (const failure of summary.failures) {
      lines.push(`             ${failure.emailId}: ${failure.error}`);
    }
  }

  lines.push("");

  return lines;
}
