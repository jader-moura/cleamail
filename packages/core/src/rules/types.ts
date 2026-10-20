import { z } from "zod";
import { CategorySchema } from "../domain/category.js";
import { ScoreSchema } from "../domain/classification.js";
import type { ClassifiableEmail } from "../domain/email.js";

/**
 * Named signals a rule noticed without deciding anything.
 *
 * Hints exist so a weak signal is not thrown away. SPEC-008 puts them in the prompt and SPEC-014
 * shows them next to a decision, which means the user can see why an email looked like bulk mail
 * even when the model made the final call.
 */
export const HINT_IDS = [
  "has_unsubscribe_link",
  "bulk_headers",
  "gmail_category_updates",
  "gmail_category_forums",
  "no_reply_sender",
  "addressed_directly",
  "many_recipients",
  "authentication_soft_fail",
  "reply_to_mismatch",
] as const;

export const HintIdSchema = z.enum(HINT_IDS);
export type HintId = z.infer<typeof HintIdSchema>;

export const RuleHintSchema = z.object({
  id: HintIdSchema,
  /** One short phrase, shown to the user and usable in a prompt. */
  detail: z.string().trim().min(1).max(160),
});
export type RuleHint = z.infer<typeof RuleHintSchema>;

export const RULE_IDS = [
  "auth_dmarc_fail",
  "display_name_spoof",
  "allowlist",
  "blocklist",
  "known_sender",
  "gmail_category_promotions",
  "gmail_category_social",
  "bulk_mail",
] as const;

export const RuleIdSchema = z.enum(RULE_IDS);
export type RuleId = z.infer<typeof RuleIdSchema>;

/** A rule's verdict. `terminal` is what decides whether the model is consulted at all. */
export const RuleMatchSchema = z.object({
  ruleId: RuleIdSchema,
  category: CategorySchema,
  importance: ScoreSchema,
  confidence: ScoreSchema,
  reason: z.string().trim().min(1).max(240),
  /** True when this is strong enough to skip the model. */
  terminal: z.boolean(),
});
export type RuleMatch = z.infer<typeof RuleMatchSchema>;

/** A sender the user has already corrected, which is the strongest signal there is. */
export type KnownSender = {
  /** An address (`a@b.c`) or a bare domain (`b.c`). */
  readonly pattern: string;
  readonly category: z.infer<typeof CategorySchema>;
  readonly confidence: number;
};

export type RuleContext = {
  /** The connected mailbox, so a rule can tell "to me" from "to a list". */
  readonly accountAddress: string;
  /** Addresses or bare domains the user never wants cleaned. */
  readonly allowlist?: readonly string[];
  /** Addresses or bare domains the user always wants cleaned. */
  readonly blocklist?: readonly string[];
  readonly knownSenders?: readonly KnownSender[];
};

/**
 * What a rule sees.
 *
 * Deliberately not the whole email: headers, labels and addresses only. Subject, snippet and body
 * are all free text the sender chose, so leaving them out of the type means no rule can be written
 * that injected text could steer. A rule that genuinely needs the subject has to widen this type on
 * purpose, which is the point.
 */
export type RuleInput = Omit<ClassifiableEmail, "bodyText" | "snippet" | "subject">;

export type Rule = {
  readonly id: RuleId;
  evaluate(email: RuleInput, context: RuleContext): RuleMatch | undefined;
};

export type RuleOutcome = {
  /** Present only when a terminal rule matched. */
  readonly match?: RuleMatch;
  readonly hints: readonly RuleHint[];
};
