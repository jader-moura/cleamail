import {
  failure,
  ok,
  systemClock,
  type AccountId,
  type Clock,
  type Email,
  type EmailId,
  type EmailStore,
  type ListStoredEmailsOptions,
  type Result,
  type SaveEmailsSummary,
} from "@cleamail/core";
import { and, count, desc, eq, gte, inArray } from "drizzle-orm";
import type { Database } from "../client.js";
import { emailToRow, rowsToEmails, rowToEmail } from "../mappers.js";
import { accounts, emails } from "../schema.js";

const DEFAULT_LIST_LIMIT = 200;

/** Keeps each `IN (...)` well under SQLite's parameter limit. */
const ID_CHUNK_SIZE = 400;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * SQLite implementation of the {@link EmailStore} port.
 *
 * Saving is an upsert keyed on the provider message id, so re-running a fetch over an overlapping
 * window updates flags and labels instead of duplicating messages. `firstSeenAt` is never
 * overwritten: it is what the trash rule later counts days from.
 */
export class SqliteEmailStore implements EmailStore {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock = systemClock,
  ) {}

  async saveEmails(toSave: readonly Email[]): Promise<Result<SaveEmailsSummary>> {
    if (toSave.length === 0) return ok({ inserted: 0, updated: 0 });

    const now = this.clock.now();

    try {
      const summary = this.db.transaction((tx): SaveEmailsSummary => {
        const existing = new Set<string>();

        for (const ids of chunk(
          toSave.map((email) => email.id),
          ID_CHUNK_SIZE,
        )) {
          const found = tx
            .select({ id: emails.id })
            .from(emails)
            .where(inArray(emails.id, ids))
            .all();
          for (const row of found) existing.add(row.id);
        }

        let inserted = 0;
        let updated = 0;

        for (const email of toSave) {
          const row = emailToRow(email, now);

          if (existing.has(email.id)) {
            const { firstSeenAt: _firstSeenAt, id: _id, ...mutable } = row;
            tx.update(emails).set(mutable).where(eq(emails.id, email.id)).run();
            updated += 1;
          } else {
            tx.insert(emails).values(row).run();
            inserted += 1;
          }
        }

        return { inserted, updated };
      });

      return ok(summary);
    } catch (cause) {
      return failure("store_failure", "Could not save emails.", cause);
    }
  }

  async getEmail(id: EmailId): Promise<Result<Email | undefined>> {
    try {
      const row = this.db.select().from(emails).where(eq(emails.id, id)).get();
      if (row === undefined) return ok(undefined);

      return rowToEmail(row);
    } catch (cause) {
      return failure("store_failure", `Could not read email ${id}.`, cause);
    }
  }

  async listEmails(options: ListStoredEmailsOptions): Promise<Result<readonly Email[]>> {
    try {
      const where =
        options.since === undefined
          ? eq(emails.accountId, options.accountId)
          : and(eq(emails.accountId, options.accountId), gte(emails.receivedAt, options.since));

      const rows = this.db
        .select()
        .from(emails)
        .where(where)
        .orderBy(desc(emails.receivedAt))
        .limit(options.limit ?? DEFAULT_LIST_LIMIT)
        .all();

      return rowsToEmails(rows);
    } catch (cause) {
      return failure("store_failure", "Could not list emails.", cause);
    }
  }

  async countEmails(accountId: AccountId): Promise<Result<number>> {
    try {
      const row = this.db
        .select({ total: count() })
        .from(emails)
        .where(eq(emails.accountId, accountId))
        .get();

      return ok(row?.total ?? 0);
    } catch (cause) {
      return failure("store_failure", "Could not count emails.", cause);
    }
  }

  async lastSyncAt(accountId: AccountId): Promise<Result<Date | undefined>> {
    try {
      const row = this.db
        .select({ lastSyncAt: accounts.lastSyncAt })
        .from(accounts)
        .where(eq(accounts.id, accountId))
        .get();

      return ok(row?.lastSyncAt ?? undefined);
    } catch (cause) {
      return failure("store_failure", "Could not read the last sync time.", cause);
    }
  }

  async recordSync(accountId: AccountId, at: Date): Promise<Result<void>> {
    try {
      const result = this.db
        .update(accounts)
        .set({ lastSyncAt: at })
        .where(eq(accounts.id, accountId))
        .run();

      if (result.changes === 0) {
        return failure("not_found", `No connected account ${accountId}.`);
      }

      return ok(undefined);
    } catch (cause) {
      return failure("store_failure", "Could not record the sync time.", cause);
    }
  }
}
