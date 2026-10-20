import {
  accountId as toAccountId,
  failure,
  MAIL_PROVIDER_KINDS,
  ok,
  systemClock,
  type AccountId,
  type Clock,
  type MailAccount,
  type MailProviderKind,
  type Result,
} from "@cleamail/core";
import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { accounts, type AccountRow } from "../schema.js";

function isProviderKind(value: string): value is MailProviderKind {
  return (MAIL_PROVIDER_KINDS as readonly string[]).includes(value);
}

function rowToAccount(row: AccountRow): Result<MailAccount> {
  if (!isProviderKind(row.kind)) {
    return failure("store_failure", `Account ${row.id} has an unknown provider kind.`);
  }

  return ok({ id: toAccountId(row.id), kind: row.kind, address: row.address });
}

/**
 * Connected mailboxes. v0.1 connects one, but every email, decision and correction is scoped by
 * account id so a second mailbox is a data change rather than a rewrite.
 */
export class SqliteAccountRepository {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock = systemClock,
  ) {}

  async upsert(account: MailAccount): Promise<Result<void>> {
    try {
      this.db
        .insert(accounts)
        .values({
          id: account.id,
          kind: account.kind,
          address: account.address,
          createdAt: this.clock.now(),
        })
        .onConflictDoUpdate({
          target: accounts.id,
          set: { kind: account.kind, address: account.address },
        })
        .run();

      return ok(undefined);
    } catch (cause) {
      return failure("store_failure", "Could not save the account.", cause);
    }
  }

  async get(id: AccountId): Promise<Result<MailAccount | undefined>> {
    try {
      const row = this.db.select().from(accounts).where(eq(accounts.id, id)).get();
      if (row === undefined) return ok(undefined);

      return rowToAccount(row);
    } catch (cause) {
      return failure("store_failure", `Could not read account ${id}.`, cause);
    }
  }

  async list(): Promise<Result<readonly MailAccount[]>> {
    try {
      const rows = this.db.select().from(accounts).all();
      const found: MailAccount[] = [];

      for (const row of rows) {
        const account = rowToAccount(row);
        if (!account.ok) return account;
        found.push(account.value);
      }

      return ok(found);
    } catch (cause) {
      return failure("store_failure", "Could not list accounts.", cause);
    }
  }
}
