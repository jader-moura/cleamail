/**
 * One place to re-export the types the commands use, so a command file imports from here instead
 * of reaching across three packages for a type.
 */
export type {
  AccountId,
  Category,
  ClassificationOutcome,
  Clock,
  Email,
  EmailClassifier,
  Logger,
  MailAccount,
  MailProvider,
  OAuthToken,
  PolicySettings,
  Result,
  RuleContext,
  TokenStore,
} from "@cleamail/core";

export type { Action, Decision } from "@cleamail/core";

/** The fixed category order the report prints in, and the engine that decides what happens. */
export { CATEGORIES, decide, removesFromInbox } from "@cleamail/core";

export type { Store } from "@cleamail/store";

export type { ClientCredentials, LoopbackReceiver, SecretStore } from "@cleamail/providers";
