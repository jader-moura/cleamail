import type { Clock, MailAccount, MailProvider, Result, Store } from "./ports.js";

/**
 * Everything the routes are allowed to touch.
 *
 * `main.ts` builds the real one; the tests build one from the in-memory store and the fake mailbox.
 * The server composes adapters and holds no business logic: it reads what the CLI wrote and calls
 * the executor, and that is the whole of it.
 */
export type ServerDeps = {
  readonly store: Store;
  readonly clock: Clock;
  /** Printed by `/api/status`, so a user can see cleamail agrees with their setting. */
  readonly classifierModel: string;
  readonly version: string;
  /**
   * The connected mailbox, from the store alone.
   *
   * Separate from `connect` on purpose. Reading what cleamail decided needs an account id and
   * nothing else, so the lists keep working when the OAuth client is missing from the keychain,
   * which is what a user with a half-finished setup actually has.
   */
  readonly account: () => Promise<Result<MailAccount>>;
  /**
   * The mailbox and a provider wired to it, for the routes that change something.
   *
   * A `Result`, because "no mailbox is connected yet" is a normal state for a server that may have
   * been started before `init`: `/api/health` and `/api/status` still answer.
   */
  readonly connect: () => Promise<Result<{ account: MailAccount; provider: MailProvider }>>;
};
