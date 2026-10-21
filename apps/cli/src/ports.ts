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
  Result,
  RuleContext,
  TokenStore,
} from "@cleamail/core";

/** The one value re-export: the fixed category order, which the report prints in. */
export { CATEGORIES } from "@cleamail/core";

export type { Store } from "@cleamail/store";

export type { ClientCredentials, LoopbackReceiver, SecretStore } from "@cleamail/providers";
