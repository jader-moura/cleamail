import { failure, ok, type Result } from "@cleamail/core";
import { z } from "zod";
import type { ClientCredentials } from "../gmail/oauth.js";
import { systemKeyring } from "./keyring-entry.js";
import { KEYRING_SERVICE, type KeyringEntryFactory } from "./keyring-token-store.js";

/** Somewhere to keep a secret that is not an OAuth token, such as the OAuth client credentials. */
export interface SecretStore {
  get(key: string): Promise<Result<string | undefined>>;
  set(key: string, value: string): Promise<Result<void>>;
  delete(key: string): Promise<Result<void>>;
}

/** Keychain-backed secrets, so nothing sensitive is ever written to a file cleamail owns. */
export class KeyringSecretStore implements SecretStore {
  private readonly createEntry: KeyringEntryFactory;
  private readonly service: string;

  constructor(createEntry: KeyringEntryFactory = systemKeyring, service: string = KEYRING_SERVICE) {
    this.createEntry = createEntry;
    this.service = service;
  }

  get(key: string): Promise<Result<string | undefined>> {
    try {
      const stored = this.createEntry(this.service, key).getPassword();

      return Promise.resolve(ok(stored === null || stored === "" ? undefined : stored));
    } catch (cause) {
      return Promise.resolve(failure("config_invalid", "Could not read from the keychain.", cause));
    }
  }

  set(key: string, value: string): Promise<Result<void>> {
    try {
      this.createEntry(this.service, key).setPassword(value);

      return Promise.resolve(ok(undefined));
    } catch (cause) {
      return Promise.resolve(failure("config_invalid", "Could not write to the keychain.", cause));
    }
  }

  delete(key: string): Promise<Result<void>> {
    try {
      this.createEntry(this.service, key).deletePassword();

      return Promise.resolve(ok(undefined));
    } catch (cause) {
      return Promise.resolve(
        failure("config_invalid", "Could not remove the keychain entry.", cause),
      );
    }
  }
}

export class InMemorySecretStore implements SecretStore {
  private readonly secrets = new Map<string, string>();

  get(key: string): Promise<Result<string | undefined>> {
    return Promise.resolve(ok(this.secrets.get(key)));
  }

  set(key: string, value: string): Promise<Result<void>> {
    this.secrets.set(key, value);

    return Promise.resolve(ok(undefined));
  }

  delete(key: string): Promise<Result<void>> {
    this.secrets.delete(key);

    return Promise.resolve(ok(undefined));
  }
}

/** The one key the Gmail client credentials live under. */
export const GOOGLE_CLIENT_KEY = "google-oauth-client";

const StoredCredentialsSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1).optional(),
});

export async function loadClientCredentials(
  secrets: SecretStore,
): Promise<Result<ClientCredentials | undefined>> {
  const stored = await secrets.get(GOOGLE_CLIENT_KEY);
  if (!stored.ok) return stored;
  if (stored.value === undefined) return ok(undefined);

  let json: unknown;
  try {
    json = JSON.parse(stored.value);
  } catch {
    return failure("config_invalid", "The stored OAuth client is not readable. Run init again.");
  }

  const parsed = StoredCredentialsSchema.safeParse(json);
  if (!parsed.success) {
    return failure("config_invalid", "The stored OAuth client is incomplete. Run init again.");
  }

  const { clientId, clientSecret } = parsed.data;

  return ok({ clientId, ...(clientSecret === undefined ? {} : { clientSecret }) });
}

export function saveClientCredentials(
  secrets: SecretStore,
  credentials: ClientCredentials,
): Promise<Result<void>> {
  return secrets.set(GOOGLE_CLIENT_KEY, JSON.stringify(credentials));
}
