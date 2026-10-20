import type { CliDeps } from "../deps.js";
import type { Email } from "../ports.js";
import { describeWindow, parseSince } from "../since.js";
import { EXIT } from "../exit.js";
import { connect } from "./account.js";

export type RunOptions = {
  readonly since: string;
  readonly max: number;
};

/**
 * Pages are bounded by the `after:` term in the query, so this cap only guards against a runaway
 * loop if a provider ever keeps handing out page tokens.
 */
const MAX_PAGES = 50;

/**
 * Fetches recent mail into the local database. Nothing is classified and nothing in the mailbox is
 * touched: this phase only has to read the inbox reliably.
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
  deps.out("Nothing in your mailbox was changed.");
  deps.out("Classification arrives in the next phase; `cleamail status` shows what is stored.");

  return EXIT.ok;
}
