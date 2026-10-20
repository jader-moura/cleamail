import { failure, ok } from "@cleamail/core";
import { loadClientCredentials } from "@cleamail/providers";
import type { CliDeps } from "../deps.js";
import type { ClientCredentials, MailAccount, MailProvider, Result } from "../ports.js";

/** The connected mailbox, or a message that says exactly what to do about it. */
export async function requireAccount(deps: CliDeps): Promise<Result<MailAccount>> {
  const accounts = await deps.store.accounts.list();
  if (!accounts.ok) return accounts;

  const account = accounts.value[0];
  if (account === undefined) {
    return failure("config_invalid", "No mailbox is connected yet. Run `cleamail init` first.");
  }

  return ok(account);
}

export async function requireCredentials(deps: CliDeps): Promise<Result<ClientCredentials>> {
  const stored = await loadClientCredentials(deps.secrets);
  if (!stored.ok) return stored;

  if (stored.value === undefined) {
    return failure(
      "config_invalid",
      "No Google OAuth client is stored. Run `cleamail init` to set one up.",
    );
  }

  return ok(stored.value);
}

/** The account plus a provider wired to it: what every command that touches mail needs. */
export async function connect(
  deps: CliDeps,
): Promise<Result<{ account: MailAccount; provider: MailProvider }>> {
  const account = await requireAccount(deps);
  if (!account.ok) return account;

  const credentials = await requireCredentials(deps);
  if (!credentials.ok) return credentials;

  return ok({
    account: account.value,
    provider: deps.makeProvider(credentials.value, account.value.id),
  });
}
