export { RULES, classificationFromRule, classifyWithRules, evaluateRules } from "./evaluate.js";
export { addressInText, findListEntry, matchesListEntry } from "./matching.js";
export { allowlistRule, blocklistRule, knownSenderRule } from "./senders.js";
export { displayNameSpoofRule, dmarcFailRule } from "./suspicious.js";
export { bulkMailRule, collectHints, gmailPromotionsRule, gmailSocialRule } from "./bulk.js";
export {
  HINT_IDS,
  HintIdSchema,
  RULE_IDS,
  RuleHintSchema,
  RuleIdSchema,
  RuleMatchSchema,
  type HintId,
  type KnownSender,
  type Rule,
  type RuleContext,
  type RuleHint,
  type RuleId,
  type RuleInput,
  type RuleMatch,
  type RuleOutcome,
} from "./types.js";
