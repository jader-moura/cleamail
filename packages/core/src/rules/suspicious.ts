import { addressDomain } from "../domain/email.js";
import { getHeader } from "../domain/headers.js";
import { addressInText } from "./matching.js";
import type { Rule } from "./types.js";

/**
 * A hard DMARC failure.
 *
 * DMARC is the one authentication result worth acting on by itself: it means the sender's own
 * domain published a policy and this message did not satisfy it. SPF and DKIM fail routinely on
 * forwarded and mailing-list mail, so those are only hints.
 *
 * `suspicious` is a protective verdict: the policy engine labels and never archives or trashes it,
 * so a false positive here costs the user a label, not a message.
 */
export const dmarcFailRule: Rule = {
  id: "auth_dmarc_fail",

  evaluate: (email) => {
    const results = getHeader(email.headers, "authentication-results");
    if (results === undefined) return undefined;

    if (!/dmarc=(?:fail|temperror|permerror)/i.test(results)) return undefined;

    return {
      ruleId: "auth_dmarc_fail",
      category: "suspicious",
      importance: 0.5,
      confidence: 0.8,
      reason: "The sender's domain failed its own DMARC check.",
      terminal: true,
    };
  },
};

/**
 * A display name that contains a different email address than the one actually sending.
 *
 * "Your Bank <noreply@bank.example>" is fine. "support@bank.example <attacker@evil.example>" is the
 * classic trick, and it is checked before the allowlist on purpose: otherwise a spoofed display
 * name could borrow a trusted sender's standing.
 */
export const displayNameSpoofRule: Rule = {
  id: "display_name_spoof",

  evaluate: (email) => {
    const name = email.from.name;
    if (name === undefined || name === "") return undefined;

    const claimed = addressInText(name);
    if (claimed === undefined) return undefined;

    const actual = email.from.address.trim().toLowerCase();
    if (claimed === actual) return undefined;

    const claimedDomain = addressDomain({ address: claimed });
    const actualDomain = addressDomain({ address: actual });
    if (claimedDomain === undefined || actualDomain === undefined) return undefined;
    if (claimedDomain === actualDomain) return undefined;

    return {
      ruleId: "display_name_spoof",
      category: "suspicious",
      importance: 0.6,
      confidence: 0.85,
      reason: `The sender name claims ${claimedDomain} but the message comes from ${actualDomain}.`,
      terminal: true,
    };
  },
};
