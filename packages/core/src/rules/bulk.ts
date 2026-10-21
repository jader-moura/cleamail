import { addressDomain } from "../domain/email.js";
import { getHeader, hasHeader } from "../domain/headers.js";
import { addressInText } from "./matching.js";
import type { Rule, RuleContext, RuleHint, RuleInput } from "./types.js";

const GMAIL_PROMOTIONS = "CATEGORY_PROMOTIONS";
const GMAIL_SOCIAL = "CATEGORY_SOCIAL";
const GMAIL_UPDATES = "CATEGORY_UPDATES";
const GMAIL_FORUMS = "CATEGORY_FORUMS";

const NO_REPLY = /^(?:no-?reply|do-?not-?reply|donotreply|noreply)[@+]/i;

/** Enough recipients that the message was clearly not written for one person. */
const MANY_RECIPIENTS = 5;

function hasLabel(email: RuleInput, label: string): boolean {
  return email.providerLabels.includes(label);
}

/**
 * Gmail's own promotions category.
 *
 * Terminal because Google has far more signal for this than cleamail ever will, and because the
 * action is reversible: labelled `cleamail/Cleaned`, archived, one click to undo.
 */
export const gmailPromotionsRule: Rule = {
  id: "gmail_category_promotions",

  evaluate: (email) =>
    hasLabel(email, GMAIL_PROMOTIONS)
      ? {
          ruleId: "gmail_category_promotions",
          category: "promotion",
          importance: 0.05,
          confidence: 0.9,
          reason: "Gmail filed this under Promotions.",
          terminal: true,
        }
      : undefined,
};

/** Gmail's social category: notifications from social networks. */
export const gmailSocialRule: Rule = {
  id: "gmail_category_social",

  evaluate: (email) =>
    hasLabel(email, GMAIL_SOCIAL)
      ? {
          ruleId: "gmail_category_social",
          category: "notification",
          importance: 0.1,
          confidence: 0.85,
          reason: "Gmail filed this under Social.",
          terminal: true,
        }
      : undefined,
};

/**
 * Bulk mail, by its headers.
 *
 * `List-Unsubscribe` alone is not enough: password resets, receipts and order confirmations carry
 * it, and archiving those is exactly the false positive the accuracy promise forbids. Combined with
 * `List-Id` or `Precedence: bulk`, it means a mailing list, and that is safe to act on.
 */
export const bulkMailRule: Rule = {
  id: "bulk_mail",

  evaluate: (email) => {
    const unsubscribe = hasHeader(email.headers, "list-unsubscribe");
    if (!unsubscribe) return undefined;

    const precedence = getHeader(email.headers, "precedence") ?? "";
    const listish = hasHeader(email.headers, "list-id") || /bulk|list|junk/i.test(precedence);
    if (!listish) return undefined;

    return {
      ruleId: "bulk_mail",
      category: "newsletter",
      importance: 0.15,
      confidence: 0.85,
      reason: "A mailing list message with an unsubscribe link.",
      // Not terminal, and this is a correction.
      //
      // SPEC-007 made this terminal on the theory that `List-Unsubscribe` alone catches receipts but
      // `List-Unsubscribe` plus `List-Id` means a real mailing list. Measuring it proved otherwise:
      // a shop receipt carrying `List-Id: receipts.store.example` was classified `newsletter` with
      // the model never consulted, which is precisely the archived-receipt false positive the first
      // promise forbids.
      //
      // A rule cannot fix this, because `RuleInput` deliberately excludes the subject and body: it
      // has no way to tell a receipt from a digest. So the headers become a strong hint and the
      // model, which can read the subject, decides. Gmail's own categories stay terminal because
      // Google classified those with full access to the content.
      terminal: false,
    };
  },
};

/**
 * Signals worth passing to the model without deciding anything.
 *
 * Each one is real but ambiguous on its own, which is exactly what a classifier is for.
 */
export function collectHints(email: RuleInput, context: RuleContext): RuleHint[] {
  const hints: RuleHint[] = [];

  if (hasHeader(email.headers, "list-unsubscribe")) {
    hints.push({ id: "has_unsubscribe_link", detail: "Has an unsubscribe link." });
  }

  // `Precedence` counts as well as `List-Id`, so the model sees every signal the bulk rule weighed
  // back when it was the one deciding.
  if (
    hasHeader(email.headers, "list-id") ||
    /bulk|list|junk/i.test(getHeader(email.headers, "precedence") ?? "")
  ) {
    hints.push({ id: "bulk_headers", detail: "Sent through a mailing list." });
  }

  if (hasLabel(email, GMAIL_UPDATES)) {
    // Receipts, invoices and shipping notices live here, so this is never a verdict.
    hints.push({ id: "gmail_category_updates", detail: "Gmail filed this under Updates." });
  }

  if (hasLabel(email, GMAIL_FORUMS)) {
    hints.push({ id: "gmail_category_forums", detail: "Gmail filed this under Forums." });
  }

  if (NO_REPLY.test(email.from.address)) {
    hints.push({ id: "no_reply_sender", detail: "Sent from a no-reply address." });
  }

  const recipients = [...email.to];
  const addressedToUser = recipients.some(
    (recipient) =>
      recipient.address.trim().toLowerCase() === context.accountAddress.trim().toLowerCase(),
  );

  if (addressedToUser && recipients.length === 1) {
    hints.push({ id: "addressed_directly", detail: "Addressed only to you." });
  }

  if (recipients.length >= MANY_RECIPIENTS) {
    hints.push({
      id: "many_recipients",
      detail: `Sent to ${recipients.length} recipients.`,
    });
  }

  const authentication = getHeader(email.headers, "authentication-results");
  if (authentication !== undefined && /(?:spf|dkim)=(?:fail|softfail)/i.test(authentication)) {
    // Common on forwarded and list mail, so a hint rather than a verdict.
    hints.push({
      id: "authentication_soft_fail",
      detail: "SPF or DKIM did not pass.",
    });
  }

  const replyToHeader = getHeader(email.headers, "reply-to");
  const replyTo = replyToHeader === undefined ? undefined : addressInText(replyToHeader);
  if (replyTo !== undefined) {
    const replyDomain = addressDomain({ address: replyTo });
    const fromDomain = addressDomain(email.from);

    if (replyDomain !== undefined && fromDomain !== undefined && replyDomain !== fromDomain) {
      hints.push({
        id: "reply_to_mismatch",
        detail: `Replies would go to ${replyDomain}.`,
      });
    }
  }

  return hints;
}
