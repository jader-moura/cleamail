import type {
  Clock,
  EmailClassifier,
  LoopbackReceiver,
  MailProvider,
  OAuthToken,
  Result,
} from "./ports.js";
import type { SecretStore, Store, TokenStore } from "./ports.js";
import type { ClientCredentials } from "./ports.js";

/**
 * Everything the commands are allowed to touch.
 *
 * The CLI is the composition root: `main.ts` builds the real version of this, and the tests build
 * one out of the in-memory store, the fake provider and stub prompts. No command reaches for a
 * global, which is why every command in this app is testable without a mailbox or a keychain.
 */
export type CliDeps = {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly clock: Clock;

  readonly store: Store;
  readonly tokens: TokenStore;
  readonly secrets: SecretStore;

  /** Builds a provider for an account whose token is already stored. */
  readonly makeProvider: (credentials: ClientCredentials, accountId: string) => MailProvider;
  /** Builds a provider from a token in hand, used during `init` before the account is known. */
  readonly makeProviderForToken: (accessToken: string) => MailProvider;

  readonly prompt: (question: string) => Promise<string>;
  readonly openUrl: (url: string) => Promise<void>;

  readonly oauth: {
    readonly startReceiver: () => Promise<LoopbackReceiver>;
    readonly exchange: (options: {
      credentials: ClientCredentials;
      code: string;
      codeVerifier: string;
      redirectUri: string;
    }) => Promise<Result<OAuthToken>>;
  };

  readonly checkOllama: () => Promise<Result<readonly string[]>>;
  /** The classifier model in use, from `CLEAMAIL_MODEL` or the documented default. */
  readonly classifierModel: string;
  /** Built on demand: a run that never classifies should not need a reachable model server. */
  readonly makeClassifier: () => Result<EmailClassifier>;

  /**
   * A line that replaces itself, for progress during a long run. Separate from `out` so the report
   * is never interleaved with counters, and so tests can ignore it.
   */
  readonly progress: (line: string) => void;
};
