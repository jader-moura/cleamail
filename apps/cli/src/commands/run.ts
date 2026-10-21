import { classifyEmails } from "@cleamail/core";
import type { CliDeps } from "../deps.js";
import type { Email } from "../ports.js";
import { formatReport } from "../report.js";
import { describeWindow, parseSince } from "../since.js";
import { EXIT } from "../exit.js";
import { connect } from "./account.js";

export type RunOptions = {
  readonly since: string;
  readonly max: number;
  /** When false, the run stops after fetching and says why it went no further. */
  readonly classify: boolean;
};

/**
 * Pages are bounded by the `after:` term in the query, so this cap only guards against a runaway
 * loop if a provider ever keeps handing out page tokens.
 */
const MAX_PAGES = 50;

/**
 * Fetches recent mail, classifies it, and prints the dry-run report.
 *
 * Nothing in the mailbox is touched. Actions arrive with the policy engine in SPEC-011, so for now
 * every run is a dry run whether the flag is given or not, and the report says so.
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

  const outcomes = await classifyEmails(stored.value, {
    classifier: classifier.value,
    context: { accountAddress: account.address },
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

  for (const line of formatReport({
    emails: stored.value,
    outcomes: outcomes.value,
    model: deps.classifierModel,
  })) {
    deps.out(line);
  }

  return EXIT.ok;
}
