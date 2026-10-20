import { GOOGLE_CLIENT_KEY } from "@cleamail/providers";
import type { CliDeps } from "../deps.js";
import { EXIT } from "../exit.js";
import { requireAccount } from "./account.js";

/**
 * Removes the credentials from the keychain. The local database is left alone on purpose: it is the
 * user's data, and deleting it should be a separate, explicit act.
 */
export async function logoutCommand(deps: CliDeps): Promise<number> {
  const account = await requireAccount(deps);

  if (account.ok) {
    const removed = await deps.tokens.delete(account.value.id);
    if (!removed.ok) {
      deps.err(removed.error.message);

      return EXIT.failure;
    }
  }

  const client = await deps.secrets.delete(GOOGLE_CLIENT_KEY);
  if (!client.ok) {
    deps.err(client.error.message);

    return EXIT.failure;
  }

  deps.out("Removed the stored credentials from your keychain.");
  deps.out(`The local database is untouched: ${deps.store.path}`);
  deps.out("You can also revoke access at https://myaccount.google.com/permissions");

  return EXIT.ok;
}
