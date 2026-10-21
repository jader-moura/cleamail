import {
  buildAuthorizationUrl,
  createPkcePair,
  createState,
  FORBIDDEN_SCOPES,
  hasOnlyAllowedScopes,
  saveClientCredentials,
} from "@cleamail/providers";
import { loadClientCredentials } from "@cleamail/providers";
import type { CliDeps } from "../deps.js";
import { EXIT } from "../exit.js";
import type { ClientCredentials, Result } from "../ports.js";

export type InitOptions = {
  /** Ask Google for access that cannot change anything. For trying cleamail out safely. */
  readonly readOnly: boolean;
};

/**
 * The setup guide, as printed to the user.
 *
 * Split into the repository and the path because `setup-guide.test.ts` checks that the path
 * still exists in this repo. A link printed into a terminal is the one kind of documentation
 * nobody notices has rotted, and this one shipped with the owner name misspelled.
 */
export const REPOSITORY_URL = "https://github.com/jader-moura/cleamail";
export const SETUP_GUIDE_PATH = "docs/gmail-setup.md";
const SETUP_GUIDE = `${REPOSITORY_URL}/blob/main/${SETUP_GUIDE_PATH}`;

/**
 * Connects a mailbox.
 *
 * The order matters: tell the user about Ollama first (a missing model server is a warning, not a
 * blocker, because nothing is classified yet), then do the OAuth dance, then write the account.
 * Nothing is stored until Google has actually said yes.
 */
export async function initCommand(
  deps: CliDeps,
  options: InitOptions = { readOnly: false },
): Promise<number> {
  deps.out("cleamail runs entirely on your machine. Nothing here is sent anywhere else.");
  deps.out("");

  if (options.readOnly) {
    deps.out(
      "Read-only mode: cleamail will ask Google for access that cannot change your mailbox.",
    );
    deps.out(
      "Google itself will refuse any change, so nothing can be labelled, archived or moved.",
    );
    deps.out("Re-run `cleamail init` without --read-only when you want it to act.");
    deps.out("");
  }

  const ollama = await deps.checkOllama();
  if (ollama.ok) {
    deps.out(`Ollama is running with ${ollama.value.length} model(s).`);
  } else {
    deps.out(`Ollama is not reachable yet. ${ollama.error.message}`);
    deps.out("You can finish connecting your mailbox now and install Ollama later.");
  }
  deps.out("");

  const credentials = await resolveCredentials(deps);
  if (!credentials.ok) {
    deps.err(credentials.error.message);

    return EXIT.failure;
  }

  const saved = await saveClientCredentials(deps.secrets, credentials.value);
  if (!saved.ok) {
    deps.err(saved.error.message);

    return EXIT.failure;
  }

  const receiver = await deps.oauth.startReceiver();

  try {
    const pkce = createPkcePair();
    const state = createState();
    const url = buildAuthorizationUrl({
      clientId: credentials.value.clientId,
      redirectUri: receiver.redirectUri,
      state,
      codeChallenge: pkce.challenge,
      access: options.readOnly ? "readonly" : "modify",
    });

    deps.out("Opening Google in your browser to authorize read and label access.");
    deps.out("If it does not open, paste this into your browser:");
    deps.out("");
    deps.out(url);
    deps.out("");

    await deps.openUrl(url);

    const code = await receiver.waitForCode(state);
    if (!code.ok) {
      deps.err(code.error.message);

      return EXIT.failure;
    }

    const token = await deps.oauth.exchange({
      credentials: credentials.value,
      code: code.value,
      codeVerifier: pkce.verifier,
      redirectUri: receiver.redirectUri,
    });
    if (!token.ok) {
      deps.err(token.error.message);

      return EXIT.failure;
    }

    const scopes = hasOnlyAllowedScopes(token.value, FORBIDDEN_SCOPES);
    if (!scopes.ok) {
      deps.err(scopes.error.message);
      deps.err("Nothing was stored. Create the client with only the gmail.modify scope.");

      return EXIT.failure;
    }

    // The account id is the mailbox address, so it has to come from Google before anything is
    // written: the token is stored under that id.
    const profile = await deps.makeProviderForToken(token.value.accessToken).account();
    if (!profile.ok) {
      deps.err(`Connected, but could not read the mailbox: ${profile.error.message}`);

      return EXIT.failure;
    }

    const stored = await deps.tokens.set(profile.value.id, token.value);
    if (!stored.ok) {
      deps.err(stored.error.message);

      return EXIT.failure;
    }

    const upserted = await deps.store.accounts.upsert(profile.value);
    if (!upserted.ok) {
      deps.err(upserted.error.message);

      return EXIT.failure;
    }

    deps.out(`Connected ${profile.value.address}.`);
    deps.out("The credential is in your operating system keychain, not in a file.");
    deps.out("");
    deps.out("Next: cleamail run --dry-run --since 7d");

    return EXIT.ok;
  } finally {
    receiver.close();
  }
}

/**
 * Takes the client credentials from the environment, the keychain, or the user, in that order. The
 * environment comes first so a scripted setup does not need a prompt.
 */
async function resolveCredentials(deps: CliDeps): Promise<Result<ClientCredentials>> {
  const envId = deps.env["CLEAMAIL_GOOGLE_CLIENT_ID"];
  const envSecret = deps.env["CLEAMAIL_GOOGLE_CLIENT_SECRET"];

  if (envId !== undefined && envId !== "") {
    return {
      ok: true,
      value: {
        clientId: envId,
        ...(envSecret === undefined || envSecret === "" ? {} : { clientSecret: envSecret }),
      },
    };
  }

  const stored = await loadClientCredentials(deps.secrets);
  if (!stored.ok) return stored;

  if (stored.value !== undefined) {
    deps.out("Using the Google OAuth client already in your keychain.");

    return { ok: true, value: stored.value };
  }

  deps.out("cleamail needs your own Google OAuth client, which takes about three minutes:");
  deps.out(SETUP_GUIDE);
  deps.out("");

  const clientId = (await deps.prompt("Google client ID: ")).trim();
  if (clientId === "") {
    return { ok: false, error: { code: "config_invalid", message: "A client ID is required." } };
  }

  const clientSecret = (await deps.prompt("Google client secret (press enter to skip): ")).trim();

  return {
    ok: true,
    value: { clientId, ...(clientSecret === "" ? {} : { clientSecret }) },
  };
}
