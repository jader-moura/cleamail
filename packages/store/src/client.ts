import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import SqliteDatabase from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { IN_MEMORY, resolveDatabasePath } from "./paths.js";
import * as schema from "./schema.js";

export type Database = BetterSQLite3Database<typeof schema>;

/** How long a write waits for another process to finish before giving up. */
const BUSY_TIMEOUT_MS = 5000;

export type OpenDatabaseOptions = {
  /** Absolute path, or `:memory:` for tests. Defaults to the per-user data directory. */
  readonly path?: string;
};

export type DatabaseHandle = {
  readonly db: Database;
  readonly path: string;
  readonly close: () => void;
};

/** Shipped next to the built code, so migrations work from an installed package too. */
function migrationsFolder(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
}

/**
 * Opens the local database, creating the file and applying any pending migrations.
 *
 * Migrations run on open on purpose: a user upgrading cleamail should never have to run a migrate
 * command, and a half-migrated database must never be handed to the pipeline.
 */
export function openDatabase(options: OpenDatabaseOptions = {}): DatabaseHandle {
  const path = options.path ?? resolveDatabasePath();

  if (path !== IN_MEMORY) {
    mkdirSync(dirname(path), { recursive: true });
  }

  const sqlite = new SqliteDatabase(path);

  // WAL keeps the background service and the dashboard from blocking each other; foreign keys are
  // off by default in SQLite, and the schema relies on them to cascade deletes.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  // WAL still allows only one writer at a time, and without this a write that collides with the
  // server's fails instantly with SQLITE_BUSY rather than waiting the moment it takes. A run that
  // applied half a batch because the dashboard happened to be writing would be the worst kind of
  // bug to reproduce.
  sqlite.pragma(`busy_timeout = ${String(BUSY_TIMEOUT_MS)}`);

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: migrationsFolder() });

  return {
    db,
    path,
    close: () => {
      sqlite.close();
    },
  };
}
