export {
  openDatabase,
  type Database,
  type DatabaseHandle,
  type OpenDatabaseOptions,
} from "./client.js";
export {
  DATABASE_FILE_NAME,
  IN_MEMORY,
  resolveDataDirectory,
  resolveDatabasePath,
  type PathEnvironment,
} from "./paths.js";
export { emailToRow, rowsToEmails, rowToEmail } from "./mappers.js";
export { SqliteAccountRepository } from "./repositories/account-repository.js";
export { SqliteEmailStore } from "./repositories/email-repository.js";
export { SqliteSettingsRepository } from "./repositories/settings-repository.js";
export { openInMemoryStore, openStore, type Store, type StoreOptions } from "./store.js";
export * as schema from "./schema.js";
