import { z } from "zod";
import { HeadersSchema } from "./headers.js";
import { AccountIdSchema, EmailIdSchema, ThreadIdSchema } from "./ids.js";

/**
 * Addresses are kept as provider gave them, only trimmed. Validation here is deliberately loose:
 * real mailboxes receive malformed addresses, and dropping a message because its `From` header is
 * odd would break the first promise (never lose what matters).
 */
export const EmailAddressSchema = z.object({
  address: z.string().min(1),
  name: z.string().optional(),
});
export type EmailAddress = z.infer<typeof EmailAddressSchema>;

/**
 * A provider-neutral message. Everything the rules layer, the classifier and the policy engine
 * need, and nothing provider-specific: no Gmail payload, no IMAP envelope, no HTML.
 */
export const EmailSchema = z.object({
  id: EmailIdSchema,
  threadId: ThreadIdSchema,
  accountId: AccountIdSchema,
  from: EmailAddressSchema,
  to: z.array(EmailAddressSchema).default([]),
  cc: z.array(EmailAddressSchema).default([]),
  replyTo: EmailAddressSchema.optional(),
  subject: z.string().default(""),
  /** Short provider-supplied preview, used in lists and in the dashboard. */
  snippet: z.string().default(""),
  /** Plain text only. Adapters strip HTML, which keeps prompts small and markup out of the store. */
  bodyText: z.string().default(""),
  headers: HeadersSchema.default({}),
  /** Provider labels or folders as-is, including Gmail categories such as `CATEGORY_PROMOTIONS`. */
  providerLabels: z.array(z.string()).default([]),
  isRead: z.boolean(),
  isStarred: z.boolean(),
  isInInbox: z.boolean(),
  receivedAt: z.coerce.date(),
  sizeBytes: z.number().int().nonnegative().default(0),
});

export type Email = z.infer<typeof EmailSchema>;

/** The subset the classifier is allowed to see, so no other field can leak into a prompt. */
export type ClassifiableEmail = Pick<
  Email,
  "id" | "from" | "to" | "subject" | "snippet" | "bodyText" | "headers" | "providerLabels"
>;

export function formatAddress(address: EmailAddress): string {
  return address.name === undefined || address.name === ""
    ? address.address
    : `${address.name} <${address.address}>`;
}

/** Lowercased domain of an address, for allowlist and known-sender matching. */
export function addressDomain(address: EmailAddress): string | undefined {
  const at = address.address.lastIndexOf("@");
  if (at === -1 || at === address.address.length - 1) return undefined;
  return address.address.slice(at + 1).toLowerCase();
}
