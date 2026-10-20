import { findListEntry, matchesListEntry } from "./matching.js";
import type { Rule } from "./types.js";

/**
 * The user's allowlist.
 *
 * Classified `important`, which the policy engine stars and keeps in the inbox. The user said this
 * sender matters, and in v0.1 that is the strongest way the domain can express "never clean this".
 */
export const allowlistRule: Rule = {
  id: "allowlist",

  evaluate: (email, context) => {
    const entry = findListEntry(email.from, context.allowlist);
    if (entry === undefined) return undefined;

    return {
      ruleId: "allowlist",
      category: "important",
      importance: 0.9,
      confidence: 0.95,
      reason: `${entry} is on your allowlist.`,
      terminal: true,
    };
  },
};

/**
 * The user's blocklist. Treated as promotional, which is what the default policy archives and
 * labels `cleamail/Cleaned`, with undo still available.
 */
export const blocklistRule: Rule = {
  id: "blocklist",

  evaluate: (email, context) => {
    const entry = findListEntry(email.from, context.blocklist);
    if (entry === undefined) return undefined;

    return {
      ruleId: "blocklist",
      category: "promotion",
      importance: 0.05,
      confidence: 0.95,
      reason: `${entry} is on your blocklist.`,
      terminal: true,
    };
  },
};

/** The lowest confidence a past correction needs before it decides on its own. */
const KNOWN_SENDER_THRESHOLD = 0.8;

/**
 * Senders the user has corrected before.
 *
 * This is the rule that makes the "this was wrong" button worth pressing: once the user has moved a
 * sender into a category, that choice decides, and the model is not asked again. SPEC-017 fills the
 * list from the corrections table; until then the context is empty and the rule does nothing.
 */
export const knownSenderRule: Rule = {
  id: "known_sender",

  evaluate: (email, context) => {
    const known = context.knownSenders?.find((candidate) =>
      matchesListEntry(email.from, candidate.pattern),
    );

    if (known === undefined || known.confidence < KNOWN_SENDER_THRESHOLD) return undefined;

    return {
      ruleId: "known_sender",
      category: known.category,
      importance: known.category === "important" || known.category === "needs_reply" ? 0.85 : 0.1,
      confidence: Math.min(known.confidence, 1),
      reason: `You previously filed mail from ${known.pattern} as ${known.category.replace("_", " ")}.`,
      terminal: true,
    };
  },
};
