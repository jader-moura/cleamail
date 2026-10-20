import {
  EmailSchema,
  accountId as toAccountId,
  domainError,
  err,
  getHeader,
  normalizeHeaders,
  ok,
  type Email,
  type RawHeader,
  type Result,
} from "@cleamail/core";
import { parseAddress, parseAddressList } from "../mime/addresses.js";
import { decodeBase64Url } from "../mime/base64.js";
import { selectBodyText, type TextPart } from "../mime/body.js";
import { decodeEncodedWords } from "../mime/rfc2047.js";
import type { GmailMessage, GmailPart } from "./types.js";

/** Gmail's own labels for state, as opposed to the user's and ours. */
const LABEL_UNREAD = "UNREAD";
const LABEL_STARRED = "STARRED";
const LABEL_INBOX = "INBOX";

function collectHeaders(payload: GmailPart | undefined): RawHeader[] {
  return (payload?.headers ?? []).map((header) => ({ name: header.name, value: header.value }));
}

/** Flattens the MIME tree into decoded leaves, which is all the body selector needs. */
function collectTextParts(part: GmailPart | undefined, into: TextPart[] = []): TextPart[] {
  if (part === undefined) return into;

  if (part.parts !== undefined && part.parts.length > 0) {
    for (const child of part.parts) collectTextParts(child, into);
    return into;
  }

  const mimeType = part.mimeType ?? "text/plain";
  const data = part.body?.data;

  if (data !== undefined && data !== "") {
    into.push({
      mimeType,
      filename: part.filename ?? "",
      text: decodeBase64Url(data),
    });
  }

  return into;
}

function receivedAt(message: GmailMessage, headerDate: string | undefined): Date | undefined {
  if (message.internalDate !== undefined && message.internalDate !== "") {
    const ms = Number.parseInt(message.internalDate, 10);
    if (!Number.isNaN(ms)) return new Date(ms);
  }

  if (headerDate !== undefined) {
    const parsed = new Date(headerDate);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return undefined;
}

/**
 * Gmail message to domain {@link Email}.
 *
 * Nothing Gmail-specific survives this function: labels become plain strings, the MIME tree becomes
 * one plain-text body, and headers become a lowercase record. A message without a usable date is
 * rejected rather than defaulted to "now", because the trash rule and the dry-run window both count
 * on `receivedAt` being real.
 */
export function gmailMessageToEmail(
  message: GmailMessage,
  account: string,
  /**
   * Gmail label ids to their names. User labels come back as opaque ids such as `Label_7`, which
   * mean nothing to the rules layer or to the user, so the adapter resolves them here. System
   * labels (`INBOX`, `CATEGORY_PROMOTIONS`) are their own name and pass through untouched.
   */
  labelNames: ReadonlyMap<string, string> = new Map(),
): Result<Email> {
  const rawHeaders = collectHeaders(message.payload);
  const headers = normalizeHeaders(rawHeaders);

  const date = receivedAt(message, getHeader(headers, "date"));
  if (date === undefined) {
    return err(
      domainError("invalid_provider_data", `Gmail message ${message.id} has no usable date.`),
    );
  }

  const from = parseAddress(getHeader(headers, "from") ?? "");
  if (from === undefined) {
    return err(domainError("invalid_provider_data", `Gmail message ${message.id} has no sender.`));
  }

  const replyTo = parseAddress(getHeader(headers, "reply-to") ?? "");

  const candidate = {
    id: message.id,
    threadId: message.threadId,
    accountId: toAccountId(account),
    from,
    to: parseAddressList(getHeader(headers, "to")),
    cc: parseAddressList(getHeader(headers, "cc")),
    ...(replyTo === undefined ? {} : { replyTo }),
    subject: decodeEncodedWords(getHeader(headers, "subject") ?? ""),
    snippet: decodeEncodedWords(message.snippet),
    bodyText: selectBodyText(collectTextParts(message.payload)),
    headers,
    providerLabels: message.labelIds.map((id) => labelNames.get(id) ?? id),
    isRead: !message.labelIds.includes(LABEL_UNREAD),
    isStarred: message.labelIds.includes(LABEL_STARRED),
    isInInbox: message.labelIds.includes(LABEL_INBOX),
    receivedAt: date,
    sizeBytes: message.sizeEstimate ?? 0,
  };

  const parsed = EmailSchema.safeParse(candidate);
  if (!parsed.success) {
    return err(
      domainError(
        "invalid_provider_data",
        `Gmail message ${message.id} could not be mapped to an email.`,
        parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.code}`).join("; "),
      ),
    );
  }

  return ok(parsed.data);
}
