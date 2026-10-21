import {
  failure,
  ok,
  type AccountId,
  type OAuthToken,
  type Result,
  type TokenStore,
} from "@cleamail/core";
import { parseToken, serializeToken } from "./token-codec.js";

export const KEYRING_SERVICE = "cleamail";

/** The slice of the keychain entry this store uses, so tests do not need a real keychain. */
export interface KeyringEntry {
  getPassword(): string | null;
  setPassword(password: string): void;
  deletePassword(): boolean;
}

export type KeyringEntryFactory = (service: string, account: string) => KeyringEntry;

// Imported lazily, so loading this module does not require a keychain to exist. See
// `keyring-entry.ts` for why that matters.
import { systemKeyring } from "./keyring-entry.js";

/**
 * Credentials in the OS keychain: Keychain on macOS, Credential Manager on Windows, the Secret
 * Service on Linux.
 *
 * Nothing is written to a file in the repo or the data directory, and no token value is ever put in
 * a message or a log line: the errors here say what to do ("reconnect"), never what was stored.
 */
export class KeyringTokenStore implements TokenStore {
  constructor(
    private readonly createEntry: KeyringEntryFactory = systemKeyring,
    private readonly service: string = KEYRING_SERVICE,
  ) {}

  get(accountId: AccountId): Promise<Result<OAuthToken | undefined>> {
    try {
      const stored = this.entry(accountId).getPassword();
      if (stored === null || stored === "") return Promise.resolve(ok(undefined));

      return Promise.resolve(parseToken(stored));
    } catch (cause) {
      return Promise.resolve(
        failure("provider_auth", "Could not read the credential from the keychain.", cause),
      );
    }
  }

  set(accountId: AccountId, token: OAuthToken): Promise<Result<void>> {
    try {
      this.entry(accountId).setPassword(serializeToken(token));

      return Promise.resolve(ok(undefined));
    } catch (cause) {
      return Promise.resolve(
        failure("provider_auth", "Could not store the credential in the keychain.", cause),
      );
    }
  }

  delete(accountId: AccountId): Promise<Result<void>> {
    try {
      this.entry(accountId).deletePassword();

      return Promise.resolve(ok(undefined));
    } catch (cause) {
      return Promise.resolve(
        failure("provider_auth", "Could not remove the credential from the keychain.", cause),
      );
    }
  }

  private entry(accountId: AccountId): KeyringEntry {
    return this.createEntry(this.service, accountId);
  }
}
