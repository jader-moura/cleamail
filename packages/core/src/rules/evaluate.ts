import { ClassificationSchema, type Classification } from "../domain/classification.js";
import { bulkMailRule, collectHints, gmailPromotionsRule, gmailSocialRule } from "./bulk.js";
import { allowlistRule, blocklistRule, knownSenderRule } from "./senders.js";
import { displayNameSpoofRule, dmarcFailRule } from "./suspicious.js";
import type { Rule, RuleContext, RuleInput, RuleOutcome } from "./types.js";

/**
 * The rules, in the order they are asked.
 *
 * This order is a safety decision. Suspicion comes first, so an allowlisted display name cannot
 * launder a failed DMARC check: spoofing a trusted sender is the oldest trick there is. Then what
 * the user said explicitly, then what the user has corrected before, then what Gmail says, then
 * what the headers say. The first terminal match wins.
 */
export const RULES: readonly Rule[] = [
  dmarcFailRule,
  displayNameSpoofRule,
  allowlistRule,
  blocklistRule,
  knownSenderRule,
  gmailPromotionsRule,
  gmailSocialRule,
  bulkMailRule,
];

/**
 * Runs the rules.
 *
 * Returns a match only when a rule is confident enough to skip the model, and always returns the
 * hints, so the classifier in SPEC-008 gets the weaker signals instead of losing them.
 */
export function evaluateRules(email: RuleInput, context: RuleContext): RuleOutcome {
  const hints = collectHints(email, context);

  for (const rule of RULES) {
    const match = rule.evaluate(email, context);
    if (match?.terminal !== true) continue;

    return { match, hints };
  }

  return { hints };
}

/** Turns a terminal rule match into the classification the rest of the pipeline consumes. */
export function classificationFromRule(outcome: RuleOutcome): Classification | undefined {
  if (outcome.match === undefined) return undefined;

  const { ruleId, category, importance, confidence, reason } = outcome.match;

  // Parsed rather than cast: a rule with a 1.2 confidence or an empty reason is a bug that should
  // surface here, not three layers later in the policy engine.
  return ClassificationSchema.parse({
    category,
    importance,
    confidence,
    reason,
    source: "rule",
    ruleId,
  });
}

/** Convenience for callers that only want "did the rules settle this". */
export function classifyWithRules(
  email: RuleInput,
  context: RuleContext,
): { classification?: Classification; outcome: RuleOutcome } {
  const outcome = evaluateRules(email, context);
  const classification = classificationFromRule(outcome);

  return classification === undefined ? { outcome } : { classification, outcome };
}
