import { describe, expect, it } from "vitest";
import { emailId } from "../domain/ids.js";
import { normalizeHeaders } from "../domain/headers.js";
import { classifyWithRules, evaluateRules } from "./evaluate.js";
import { matchesListEntry } from "./matching.js";
import type { RuleContext, RuleInput } from "./types.js";

const ACCOUNT = "user@example.com";

const context: RuleContext = { accountAddress: ACCOUNT };

function input(overrides: Partial<RuleInput> = {}): RuleInput {
  return {
    id: emailId("msg-1"),
    from: { address: "news@shop.example", name: "Shop" },
    to: [{ address: ACCOUNT }],
    headers: {},
    providerLabels: ["INBOX"],
    ...overrides,
  };
}

function headers(pairs: Record<string, string>): RuleInput["headers"] {
  return normalizeHeaders(Object.entries(pairs).map(([name, value]) => ({ name, value })));
}

describe("matchesListEntry", () => {
  it("matches a full address exactly", () => {
    const address = { address: "Alerts@Bank.Example" };

    expect(matchesListEntry(address, "alerts@bank.example")).toBe(true);
    expect(matchesListEntry(address, "other@bank.example")).toBe(false);
  });

  it("matches a bare domain and its subdomains", () => {
    expect(matchesListEntry({ address: "a@bank.example" }, "bank.example")).toBe(true);
    expect(matchesListEntry({ address: "a@mail.bank.example" }, "bank.example")).toBe(true);
    expect(matchesListEntry({ address: "a@notbank.example" }, "bank.example")).toBe(false);
  });

  it("tolerates a leading @ in the entry", () => {
    expect(matchesListEntry({ address: "a@bank.example" }, "@bank.example")).toBe(true);
  });

  it("matches nothing for an empty entry", () => {
    expect(matchesListEntry({ address: "a@bank.example" }, "  ")).toBe(false);
  });

  it("matches nothing for an empty sender address", () => {
    expect(matchesListEntry({ address: "   " }, "bank.example")).toBe(false);
  });

  it("matches nothing when the sender has no domain at all", () => {
    expect(matchesListEntry({ address: "postmaster" }, "bank.example")).toBe(false);
  });
});

describe("suspicious rules", () => {
  it("flags a hard DMARC failure and never archives it", () => {
    const { classification } = classifyWithRules(
      input({ headers: headers({ "Authentication-Results": "spf=pass dmarc=fail (p=REJECT)" }) }),
      context,
    );

    expect(classification?.category).toBe("suspicious");
    expect(classification?.ruleId).toBe("auth_dmarc_fail");
    expect(classification?.source).toBe("rule");
  });

  it("treats an SPF or DKIM failure as a hint, because forwarded mail fails those", () => {
    const outcome = evaluateRules(
      input({ headers: headers({ "Authentication-Results": "spf=softfail dmarc=pass" }) }),
      context,
    );

    expect(outcome.match).toBeUndefined();
    expect(outcome.hints.map((hint) => hint.id)).toContain("authentication_soft_fail");
  });

  it("flags a display name that claims another domain", () => {
    const { classification } = classifyWithRules(
      input({
        from: { address: "attacker@evil.example", name: "support@bank.example" },
      }),
      context,
    );

    expect(classification?.category).toBe("suspicious");
    expect(classification?.ruleId).toBe("display_name_spoof");
    expect(classification?.reason).toContain("bank.example");
  });

  it("leaves an ordinary display name alone", () => {
    const outcome = evaluateRules(
      input({ from: { address: "noreply@bank.example", name: "Your Bank" } }),
      context,
    );

    expect(outcome.match).toBeUndefined();
  });

  it("accepts a display name that repeats the real address", () => {
    const outcome = evaluateRules(
      input({ from: { address: "a@bank.example", name: "a@bank.example" } }),
      context,
    );

    expect(outcome.match).toBeUndefined();
  });

  it("says nothing when the display name has no complete address in it", () => {
    const outcome = evaluateRules(
      input({ from: { address: "real@shop.example", name: "contact@" } }),
      context,
    );

    expect(outcome.match).toBeUndefined();
  });

  it("says nothing when the sender address itself has no domain to compare", () => {
    // Malformed senders are kept rather than dropped, so the rule has to cope with one.
    const outcome = evaluateRules(
      input({ from: { address: "postmaster", name: "support@bank.example" } }),
      context,
    );

    expect(outcome.match).toBeUndefined();
  });

  it("accepts a display name on the same domain", () => {
    const outcome = evaluateRules(
      input({ from: { address: "bounce@bank.example", name: "support@bank.example" } }),
      context,
    );

    expect(outcome.match).toBeUndefined();
  });

  it("checks suspicion before the allowlist, so a spoof cannot borrow trust", () => {
    const { classification } = classifyWithRules(
      input({
        from: { address: "attacker@evil.example", name: "boss@work.example" },
      }),
      { ...context, allowlist: ["evil.example"] },
    );

    expect(classification?.category).toBe("suspicious");
  });
});

describe("the user's own lists", () => {
  it("treats an allowlisted sender as important", () => {
    const { classification } = classifyWithRules(
      input({ from: { address: "mum@family.example" } }),
      {
        ...context,
        allowlist: ["family.example"],
      },
    );

    expect(classification?.category).toBe("important");
    expect(classification?.ruleId).toBe("allowlist");
    expect(classification?.importance).toBeGreaterThan(0.8);
  });

  it("treats a blocklisted sender as promotional", () => {
    const { classification } = classifyWithRules(input({ from: { address: "spam@ads.example" } }), {
      ...context,
      blocklist: ["spam@ads.example"],
    });

    expect(classification?.category).toBe("promotion");
    expect(classification?.ruleId).toBe("blocklist");
  });

  it("lets the allowlist win over the blocklist", () => {
    const { classification } = classifyWithRules(input({ from: { address: "a@both.example" } }), {
      ...context,
      allowlist: ["both.example"],
      blocklist: ["both.example"],
    });

    expect(classification?.category).toBe("important");
  });

  it("lets the allowlist win over Gmail's promotions category", () => {
    const { classification } = classifyWithRules(
      input({
        from: { address: "deals@shop.example" },
        providerLabels: ["INBOX", "CATEGORY_PROMOTIONS"],
      }),
      { ...context, allowlist: ["shop.example"] },
    );

    expect(classification?.category).toBe("important");
  });
});

describe("known senders", () => {
  it("uses a confident past correction and skips the model", () => {
    const { classification } = classifyWithRules(input({ from: { address: "a@shop.example" } }), {
      ...context,
      knownSenders: [{ pattern: "shop.example", category: "promotion", confidence: 0.9 }],
    });

    expect(classification?.ruleId).toBe("known_sender");
    expect(classification?.category).toBe("promotion");
    expect(classification?.reason).toContain("shop.example");
  });

  it("ignores a correction it is not confident about", () => {
    const outcome = evaluateRules(input({ from: { address: "a@shop.example" } }), {
      ...context,
      knownSenders: [{ pattern: "shop.example", category: "promotion", confidence: 0.4 }],
    });

    expect(outcome.match).toBeUndefined();
  });

  it("gives an important correction a high importance", () => {
    const { classification } = classifyWithRules(input({ from: { address: "a@work.example" } }), {
      ...context,
      knownSenders: [{ pattern: "a@work.example", category: "needs_reply", confidence: 0.95 }],
    });

    expect(classification?.importance).toBeGreaterThan(0.8);
  });

  it("does nothing when there are no corrections yet", () => {
    expect(evaluateRules(input(), context).match).toBeUndefined();
  });
});

describe("Gmail categories", () => {
  it("acts on Promotions", () => {
    const { classification } = classifyWithRules(
      input({ providerLabels: ["INBOX", "CATEGORY_PROMOTIONS"] }),
      context,
    );

    expect(classification?.category).toBe("promotion");
    expect(classification?.ruleId).toBe("gmail_category_promotions");
  });

  it("acts on Social", () => {
    const { classification } = classifyWithRules(
      input({ providerLabels: ["INBOX", "CATEGORY_SOCIAL"] }),
      context,
    );

    expect(classification?.category).toBe("notification");
  });

  it("only hints at Updates, where receipts and invoices live", () => {
    const outcome = evaluateRules(
      input({ providerLabels: ["INBOX", "CATEGORY_UPDATES"] }),
      context,
    );

    expect(outcome.match).toBeUndefined();
    expect(outcome.hints.map((hint) => hint.id)).toContain("gmail_category_updates");
  });

  it("only hints at Forums", () => {
    const outcome = evaluateRules(input({ providerLabels: ["INBOX", "CATEGORY_FORUMS"] }), context);

    expect(outcome.match).toBeUndefined();
    expect(outcome.hints.map((hint) => hint.id)).toContain("gmail_category_forums");
  });
});

describe("bulk mail", () => {
  it("classifies a mailing list message as a newsletter", () => {
    const { classification } = classifyWithRules(
      input({
        headers: headers({
          "List-Unsubscribe": "<mailto:unsub@shop.example>",
          "List-Id": "<news.shop.example>",
        }),
      }),
      context,
    );

    expect(classification?.category).toBe("newsletter");
    expect(classification?.ruleId).toBe("bulk_mail");
  });

  it("accepts Precedence: bulk instead of a List-Id", () => {
    const { classification } = classifyWithRules(
      input({
        headers: headers({
          "List-Unsubscribe": "<https://shop.example/u>",
          Precedence: "bulk",
        }),
      }),
      context,
    );

    expect(classification?.category).toBe("newsletter");
  });

  it("does not touch a password reset that happens to carry an unsubscribe header", () => {
    const outcome = evaluateRules(
      input({
        from: { address: "noreply@bank.example" },
        headers: headers({ "List-Unsubscribe": "<mailto:unsub@bank.example>" }),
      }),
      context,
    );

    expect(outcome.match).toBeUndefined();
    expect(outcome.hints.map((hint) => hint.id)).toContain("has_unsubscribe_link");
  });

  it("needs an unsubscribe header at all", () => {
    const outcome = evaluateRules(
      input({ headers: headers({ "List-Id": "<news.shop.example>" }) }),
      context,
    );

    expect(outcome.match).toBeUndefined();
  });
});

describe("hints", () => {
  it("notices a message addressed only to the user", () => {
    const outcome = evaluateRules(input({ to: [{ address: ACCOUNT }] }), context);

    expect(outcome.hints.map((hint) => hint.id)).toContain("addressed_directly");
  });

  it("does not claim direct address when there are other recipients", () => {
    const outcome = evaluateRules(
      input({ to: [{ address: ACCOUNT }, { address: "someone@else.example" }] }),
      context,
    );

    expect(outcome.hints.map((hint) => hint.id)).not.toContain("addressed_directly");
  });

  it("counts a large recipient list", () => {
    const outcome = evaluateRules(
      input({
        to: Array.from({ length: 6 }, (_, index) => ({ address: `p${index}@example.com` })),
      }),
      context,
    );

    const hint = outcome.hints.find((candidate) => candidate.id === "many_recipients");
    expect(hint?.detail).toContain("6");
  });

  it("notices a no-reply sender", () => {
    const outcome = evaluateRules(input({ from: { address: "no-reply@shop.example" } }), context);

    expect(outcome.hints.map((hint) => hint.id)).toContain("no_reply_sender");
  });

  it("notices when replies would go somewhere else", () => {
    const outcome = evaluateRules(
      input({ headers: headers({ "Reply-To": "Support <help@other.example>" }) }),
      context,
    );

    const hint = outcome.hints.find((candidate) => candidate.id === "reply_to_mismatch");
    expect(hint?.detail).toContain("other.example");
  });

  it("says nothing about a reply-to on the sender's own domain", () => {
    const outcome = evaluateRules(
      input({
        from: { address: "news@shop.example" },
        headers: headers({ "Reply-To": "help@shop.example" }),
      }),
      context,
    );

    expect(outcome.hints.map((hint) => hint.id)).not.toContain("reply_to_mismatch");
  });

  it("still collects hints when a rule decided the outcome", () => {
    const outcome = evaluateRules(
      input({
        providerLabels: ["INBOX", "CATEGORY_PROMOTIONS"],
        headers: headers({ "List-Unsubscribe": "<mailto:u@shop.example>" }),
      }),
      context,
    );

    expect(outcome.match?.ruleId).toBe("gmail_category_promotions");
    expect(outcome.hints.map((hint) => hint.id)).toContain("has_unsubscribe_link");
  });
});

describe("rule outcomes as classifications", () => {
  it("always produce a valid Classification with a rule source and a reason", () => {
    const cases: RuleContext[] = [
      { ...context, allowlist: ["shop.example"] },
      { ...context, blocklist: ["shop.example"] },
      { ...context, knownSenders: [{ pattern: "shop.example", category: "fyi", confidence: 0.9 }] },
    ];

    for (const candidate of cases) {
      const { classification } = classifyWithRules(input(), candidate);

      expect(classification).toBeDefined();
      expect(classification?.source).toBe("rule");
      expect(classification?.ruleId).toBeDefined();
      expect(classification?.reason.length).toBeGreaterThan(0);
      expect(classification?.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("returns nothing when no rule is confident, so the model decides", () => {
    const { classification, outcome } = classifyWithRules(
      input({ from: { address: "colleague@work.example" } }),
      context,
    );

    expect(classification).toBeUndefined();
    expect(outcome.match).toBeUndefined();
  });
});
