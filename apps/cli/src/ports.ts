/**
 * One place to re-export the types the commands use, so a command file imports from here instead
 * of reaching across three packages for a type.
 */
export type {
  AccountId,
  Clock,
  Email,
  Logger,
  MailAccount,
  MailProvider,
  OAuthToken,
  Result,
  TokenStore,
} from "@cleamail/core";

export type { Store } from "@cleamail/store";

export type { ClientCredentials, LoopbackReceiver, SecretStore } from "@cleamail/providers";
