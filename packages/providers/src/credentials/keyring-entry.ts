import { createRequire } from "node:module";
import type { KeyringEntry, KeyringEntryFactory } from "./keyring-token-store.js";

/**
 * The OS keychain, loaded only when something actually asks for it.
 *
 * `@napi-rs/keyring` is a native module. On Linux it talks to the Secret Service, which means it
 * links against libsecret and expects a session bus. Importing it at the top of a module made that
 * a condition of importing `@cleamail/providers` at all, so a machine with no desktop session could
 * not so much as load the Gmail mapper. A headless server and a CI runner are both that machine.
 *
 * Deferring the load keeps the dependency where it belongs: on the code paths that store a
 * credential, not on the package. Tests inject their own factory and never reach this.
 */
type EntryConstructor = new (service: string, account: string) => KeyringEntry;

let cached: EntryConstructor | undefined;

function entryConstructor(): EntryConstructor {
  if (cached !== undefined) return cached;

  const require = createRequire(import.meta.url);
  // `require` is typed `any`, so the shape is asserted here rather than spread through callers.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const loaded: { readonly Entry: EntryConstructor } = require("@napi-rs/keyring");

  cached = loaded.Entry;

  return cached;
}

export const systemKeyring: KeyringEntryFactory = (service, account) =>
  new (entryConstructor())(service, account);
