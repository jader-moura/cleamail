import { EmailSchema, accountId, type Email } from "@cleamail/core";
import type { EvalCase } from "./case.js";

/**
 * The mailbox the eval set is addressed to.
 *
 * A single known address is what lets a case say "this was sent to you" or "this went to a list"
 * and have the rules layer agree. Reserved by RFC 2606, like every other address in the set.
 */
export const EVAL_ACCOUNT_ADDRESS = "you@example.com";

export const EVAL_ACCOUNT_ID = accountId("eval-account");

const SNIPPET_CHARS = 140;

const MS_PER_HOUR = 3_600_000;

/**
 * Expands a stored case into the `Email` the pipeline expects.
 *
 * The derived fields are derived the way a provider derives them, not the way that would be
 * convenient: the snippet is the start of the body with whitespace collapsed, because that is what
 * Gmail hands over, and a case whose snippet was written to be more helpful than the real one would
 * flatter the classifier.
 */
export function toEmail(evalCase: EvalCase, now: Date): Email {
  const { email } = evalCase;

  return EmailSchema.parse({
    id: evalCase.id,
    threadId: `thread-${evalCase.id}`,
    accountId: EVAL_ACCOUNT_ID,
    from: email.from,
    to: email.to,
    cc: [],
    subject: email.subject,
    snippet: snippetOf(email.body),
    bodyText: email.body,
    headers: email.headers,
    providerLabels: email.providerLabels,
    isRead: false,
    isStarred: false,
    isInInbox: true,
    receivedAt: new Date(now.getTime() - email.ageHours * MS_PER_HOUR),
    sizeBytes: Buffer.byteLength(email.body, "utf8"),
  });
}

function snippetOf(body: string): string {
  const collapsed = body.replace(/\s+/g, " ").trim();

  return collapsed.length <= SNIPPET_CHARS ? collapsed : `${collapsed.slice(0, SNIPPET_CHARS)}...`;
}
