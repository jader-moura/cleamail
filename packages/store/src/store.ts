import { systemClock, type Clock } from "@cleamail/core";
import { openDatabase, type Database } from "./client.js";
import { IN_MEMORY } from "./paths.js";
import { SqliteAccountRepository } from "./repositories/account-repository.js";
import { SqliteAuditLog } from "./repositories/audit-repository.js";
import { SqliteDecisionStore } from "./repositories/decision-repository.js";
import { SqliteEmailStore } from "./repositories/email-repository.js";
import { SqliteSettingsRepository } from "./repositories/settings-repository.js";

export type StoreOptions = {
  readonly path?: string;
  readonly clock?: Clock;
};

export type Store = {
  readonly db: Database;
  readonly path: string;
  readonly accounts: SqliteAccountRepository;
  readonly emails: SqliteEmailStore;
  readonly decisions: SqliteDecisionStore;
  readonly audit: SqliteAuditLog;
  readonly settings: SqliteSettingsRepository;
  readonly close: () => void;
};

/**
 * Opens the local database and wires up the repositories. Apps call this once and inject the
 * repositories as the ports they implement.
 */
export function openStore(options: StoreOptions = {}): Store {
  const clock = options.clock ?? systemClock;
  const handle = openDatabase(options.path === undefined ? {} : { path: options.path });

  return {
    db: handle.db,
    path: handle.path,
    accounts: new SqliteAccountRepository(handle.db, clock),
    emails: new SqliteEmailStore(handle.db, clock),
    decisions: new SqliteDecisionStore(handle.db, clock),
    audit: new SqliteAuditLog(handle.db, clock),
    settings: new SqliteSettingsRepository(handle.db, clock),
    close: handle.close,
  };
}

/** A throwaway database for tests and for the dry-run eval runner. */
export function openInMemoryStore(options: Omit<StoreOptions, "path"> = {}): Store {
  return openStore({ ...options, path: IN_MEMORY });
}
