import {
  domainError,
  EmailSchema,
  err,
  failure,
  ok,
  type Email,
  type EmailAddress,
  type Result,
} from "@cleamail/core";
import type { EmailRow, NewEmailRow } from "./schema.js";

/**
 * Rows in, domain objects out, with validation in between.
 *
 * A row is external input: it may predate a migration or have been edited by hand. Parsing through
 * the domain schema means a bad row surfaces as a typed error instead of a malformed `Email`
 * flowing into the classifier or the policy engine.
 */

function parseJson(value: string, column: string): Result<unknown> {
  try {
    return ok(JSON.parse(value));
  } catch (cause) {
    return failure("store_failure", `Column ${column} does not contain valid JSON.`, cause);
  }
}

export function rowToEmail(row: EmailRow): Result<Email> {
  const to = parseJson(row.toJson, "to_json");
  if (!to.ok) return to;

  const cc = parseJson(row.ccJson, "cc_json");
  if (!cc.ok) return cc;

  const headers = parseJson(row.headersJson, "headers_json");
  if (!headers.ok) return headers;

  const providerLabels = parseJson(row.providerLabelsJson, "provider_labels_json");
  if (!providerLabels.ok) return providerLabels;

  const replyTo =
    row.replyToJson === null ? ok(undefined) : parseJson(row.replyToJson, "reply_to_json");
  if (!replyTo.ok) return replyTo;

  const candidate = {
    id: row.id,
    threadId: row.threadId,
    accountId: row.accountId,
    from: {
      address: row.fromAddress,
      ...(row.fromName === null ? {} : { name: row.fromName }),
    },
    to: to.value,
    cc: cc.value,
    ...(replyTo.value === undefined ? {} : { replyTo: replyTo.value }),
    subject: row.subject,
    snippet: row.snippet,
    bodyText: row.bodyText,
    headers: headers.value,
    providerLabels: providerLabels.value,
    isRead: row.isRead,
    isStarred: row.isStarred,
    isInInbox: row.isInInbox,
    receivedAt: row.receivedAt,
    sizeBytes: row.sizeBytes,
  };

  const parsed = EmailSchema.safeParse(candidate);
  if (!parsed.success) {
    return err(
      domainError(
        "store_failure",
        `Stored email ${row.id} does not match the domain schema.`,
        parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.code}`).join("; "),
      ),
    );
  }

  return ok(parsed.data);
}

export function rowsToEmails(rows: readonly EmailRow[]): Result<Email[]> {
  const emails: Email[] = [];

  for (const row of rows) {
    const email = rowToEmail(row);
    if (!email.ok) return email;
    emails.push(email.value);
  }

  return ok(emails);
}

function addressName(address: EmailAddress): string | null {
  return address.name === undefined || address.name === "" ? null : address.name;
}

export function emailToRow(email: Email, now: Date, firstSeenAt: Date = now): NewEmailRow {
  return {
    id: email.id,
    accountId: email.accountId,
    threadId: email.threadId,
    fromAddress: email.from.address,
    fromName: addressName(email.from),
    toJson: JSON.stringify(email.to),
    ccJson: JSON.stringify(email.cc),
    replyToJson: email.replyTo === undefined ? null : JSON.stringify(email.replyTo),
    subject: email.subject,
    snippet: email.snippet,
    bodyText: email.bodyText,
    headersJson: JSON.stringify(email.headers),
    providerLabelsJson: JSON.stringify(email.providerLabels),
    isRead: email.isRead,
    isStarred: email.isStarred,
    isInInbox: email.isInInbox,
    receivedAt: email.receivedAt,
    sizeBytes: email.sizeBytes,
    firstSeenAt,
    updatedAt: now,
  };
}
