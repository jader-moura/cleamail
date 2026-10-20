import { describe, expect, it } from "vitest";
import { HINT_IDS, RULE_IDS, RuleHintSchema, RuleMatchSchema } from "./types.js";

/**
 * The rule contract itself. These schemas are what the store and the dashboard will validate
 * against in later specs, so they are pinned down here rather than discovered later.
 */
describe("RuleMatchSchema", () => {
  const valid = {
    ruleId: "bulk_mail",
    category: "newsletter",
    importance: 0.15,
    confidence: 0.85,
    reason: "A mailing list message with an unsubscribe link.",
    terminal: true,
  };

  it("accepts a well-formed match", () => {
    expect(RuleMatchSchema.parse(valid).ruleId).toBe("bulk_mail");
  });

  it("rejects a rule id that is not in the fixed set", () => {
    expect(RuleMatchSchema.safeParse({ ...valid, ruleId: "my_own_rule" }).success).toBe(false);
  });

  it("rejects scores outside 0..1 and an empty reason", () => {
    expect(RuleMatchSchema.safeParse({ ...valid, confidence: 1.5 }).success).toBe(false);
    expect(RuleMatchSchema.safeParse({ ...valid, reason: "  " }).success).toBe(false);
  });
});

describe("RuleHintSchema", () => {
  it("accepts a known hint", () => {
    expect(
      RuleHintSchema.parse({ id: "bulk_headers", detail: "Sent through a mailing list." }),
    ).toStrictEqual({ id: "bulk_headers", detail: "Sent through a mailing list." });
  });

  it("rejects an unknown hint id", () => {
    expect(RuleHintSchema.safeParse({ id: "vibes", detail: "Feels like spam." }).success).toBe(
      false,
    );
  });
});

describe("the fixed sets", () => {
  it("have no duplicates, since both are used as stable identifiers", () => {
    expect(new Set(RULE_IDS).size).toBe(RULE_IDS.length);
    expect(new Set(HINT_IDS).size).toBe(HINT_IDS.length);
  });
});
