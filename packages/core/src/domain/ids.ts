import { z } from "zod";

/**
 * Provider ids are opaque strings that must not be mixed up, so they are branded: an `EmailId`
 * cannot be passed where a `ThreadId` is expected, even though both are strings at runtime.
 */
export const EmailIdSchema = z.string().min(1).brand<"EmailId">();
export type EmailId = z.infer<typeof EmailIdSchema>;

export const ThreadIdSchema = z.string().min(1).brand<"ThreadId">();
export type ThreadId = z.infer<typeof ThreadIdSchema>;

/** One connected mailbox. v0.1 has a single account, but decisions are stored per account. */
export const AccountIdSchema = z.string().min(1).brand<"AccountId">();
export type AccountId = z.infer<typeof AccountIdSchema>;

export function emailId(value: string): EmailId {
  return EmailIdSchema.parse(value);
}

export function threadId(value: string): ThreadId {
  return ThreadIdSchema.parse(value);
}

export function accountId(value: string): AccountId {
  return AccountIdSchema.parse(value);
}
