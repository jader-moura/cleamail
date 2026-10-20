export { GmailProvider, type GmailProviderOptions } from "./gmail/provider.js";
export { gmailMessageToEmail } from "./gmail/mapper.js";
export { buildFetchQuery } from "./gmail/query.js";
export { codeForStatus, isRetryable, toDomainError } from "./gmail/errors.js";
export { GmailHttpError, GmailRestApi, type GmailRestOptions } from "./gmail/rest-client.js";
export {
  RefreshingAccessTokenProvider,
  StaticAccessTokenProvider,
  type AccessTokenProvider,
  type RefreshingTokenOptions,
} from "./gmail/access-token.js";
export {
  buildAuthorizationUrl,
  createPkcePair,
  createState,
  exchangeAuthorizationCode,
  hasOnlyAllowedScopes,
  refreshAccessToken,
  startLoopbackReceiver,
  type AuthorizationUrlOptions,
  type ClientCredentials,
  type FetchLike,
  type LoopbackReceiver,
  type PkcePair,
  type RefreshOptions,
  type TokenExchangeOptions,
} from "./gmail/oauth.js";
export { FORBIDDEN_SCOPES, GMAIL_SCOPES, scopeString } from "./gmail/scopes.js";
export {
  GmailListResponseSchema,
  GmailMessageSchema,
  GmailLabelSchema,
  GmailProfileSchema,
  type GmailApi,
  type GmailLabel,
  type GmailListResponse,
  type GmailMessage,
  type GmailPart,
  type GmailProfile,
  type LabelChanges,
  type ListMessagesParams,
} from "./gmail/types.js";
export {
  KeyringTokenStore,
  KEYRING_SERVICE,
  type KeyringEntry,
  type KeyringEntryFactory,
} from "./credentials/keyring-token-store.js";
export { InMemoryTokenStore } from "./credentials/memory-token-store.js";
export {
  GOOGLE_CLIENT_KEY,
  InMemorySecretStore,
  KeyringSecretStore,
  loadClientCredentials,
  saveClientCredentials,
  type SecretStore,
} from "./credentials/secret-store.js";
export { isExpired, parseToken, serializeToken } from "./credentials/token-codec.js";
export {
  GMAIL_ALLOWED_HOSTS,
  GMAIL_API_BASE,
  GMAIL_API_HOST,
  GOOGLE_AUTH_HOST,
  GOOGLE_AUTH_URL,
  GOOGLE_TOKEN_HOST,
  GOOGLE_TOKEN_URL,
} from "./hosts.js";
export { htmlToText, normalizeText, selectBodyText, MAX_BODY_CHARS } from "./mime/body.js";
export { parseAddress, parseAddressList } from "./mime/addresses.js";
export { decodeEncodedWords } from "./mime/rfc2047.js";
export { decodeBase64Url } from "./mime/base64.js";
