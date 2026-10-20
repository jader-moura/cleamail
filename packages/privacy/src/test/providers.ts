/**
 * Re-exports what the pipeline test drives, so that test reads as a list of real behaviour rather
 * than a wall of imports. `LABEL_CLEANED_FOR_TEST` is the domain constant under a name that makes
 * it obvious no label string is being invented here.
 */
export { LABEL_CLEANED as LABEL_CLEANED_FOR_TEST } from "@cleamail/core";

export {
  buildAuthorizationUrl,
  createPkcePair,
  createState,
  exchangeAuthorizationCode,
  GmailProvider,
  GmailRestApi,
  InMemoryTokenStore,
  RefreshingAccessTokenProvider,
  StaticAccessTokenProvider,
} from "@cleamail/providers";
