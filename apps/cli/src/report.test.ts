import { emailId } from "@cleamail/core";
import { describe, expect, it } from "vitest";
import type { Category, ClassificationOutcome, Email } from "./ports.js";
import { categoryCounts, formatReport, pair, plain } from "./report.js";
import { anEmail } from "./test/harness.js";

function outcome(
  id: string,
  category: Category | undefined,
  overrides: Partial<ClassificationOutcome> = {},
): ClassificationOutcome {
  return {
    emailId: emailId(id),
    hints: [],
    ...(category === undefined
      ? {}
      : {
          classification: {
            category,
            importance: 0.5,
            confidence: 0.9,
            reason: `Because it looks like a ${category}.`,
            source: "model" as const,
            model: "test-model",
          },
        }),
    ...overrides,
  };
}

function report(pairs: readonly (readonly [Email, ClassificationOutcome])[]): string {
  return formatReport({
    emails: pairs.map(([email]) => email),
    outcomes: pairs.map(([, result]) => result),
    model: "test-model",
  }).join("\n");
}

describe("plain", () => {
  it("strips the escape sequences a sender could put in a subject", () => {
    // The whole sequence goes, not just the escape byte, so no "[2J" is left showing.
    expect(plain("Hi\u001b[2Jthere")).toBe("Hithere");
    expect(plain("Clear\u001b[2K\u001b[1;31m red")).toBe("Clear red");
    expect(plain("a\u0000b\rc\nd")).toBe("a b c d");
  });

  it("collapses whitespace and trims", () => {
    expect(plain("  too    many   spaces  ")).toBe("too many spaces");
  });

  it("says so rather than printing an empty column", () => {
    expect(plain("")).toBe("(no subject)");
    expect(plain("   ")).toBe("(no subject)");
  });

  it("truncates with an ellipsis", () => {
    const result = plain("x".repeat(80), 10);

    expect(result).toHaveLength(10);
    expect(result.endsWith("…")).toBe(true);
  });
});

describe("pair", () => {
  it("drops an outcome whose email is not in the batch", () => {
    const paired = pair({
      emails: [anEmail({ id: emailId("a") })],
      outcomes: [outcome("a", "fyi"), outcome("ghost", "fyi")],
      model: "test-model",
    });

    expect(paired).toHaveLength(1);
    expect(paired[0]?.email.id).toBe("a");
  });
});

describe("categoryCounts", () => {
  it("counts in the fixed category order, so two runs line up", () => {
    const paired = pair({
      emails: [
        anEmail({ id: emailId("a") }),
        anEmail({ id: emailId("b") }),
        anEmail({ id: emailId("c") }),
      ],
      outcomes: [outcome("a", "promotion"), outcome("b", "important"), outcome("c", "promotion")],
      model: "test-model",
    });

    expect([...categoryCounts(paired)]).toStrictEqual([
      ["important", 1],
      ["promotion", 2],
    ]);
  });
});

describe("formatReport", () => {
  it("says there is nothing rather than printing empty headings", () => {
    expect(report([])).toBe("Nothing to classify in that window.");
  });

  it("leads with what needs attention, including the reason", () => {
    const output = report([
      [
        anEmail({
          id: emailId("a"),
          subject: "Payment received",
          from: { address: "b@c.example", name: "Bank" },
        }),
        outcome("a", "important"),
      ],
    ]);

    expect(output).toContain("needs attention (1)");
    expect(output).toContain("important");
    expect(output).toContain("Payment received");
    expect(output).toContain("Bank <b@c.example>");
    expect(output).toContain("Because it looks like a important.");
    expect(output.indexOf("needs attention")).toBeLessThan(output.indexOf("summary"));
  });

  it("lists review items with why, not with a category alone", () => {
    const output = report([
      [
        anEmail({ id: emailId("a"), subject: "Maybe" }),
        outcome("a", "fyi", { reviewReason: "low_confidence" }),
      ],
      [
        anEmail({ id: emailId("b"), subject: "Odd" }),
        outcome("b", undefined, { reviewReason: "invalid_model_output" }),
      ],
      [
        anEmail({ id: emailId("c"), subject: "Fake" }),
        outcome("c", "suspicious", { reviewReason: "suspicious" }),
      ],
    ]);

    expect(output).toContain("needs review (3)");
    expect(output).toContain("unsure");
    expect(output).toContain("model output invalid");
    expect(output).toContain("looks like a forgery");
    expect(output).toContain("(looked like fyi)");
  });

  it("keeps a review item out of the cleanable counts", () => {
    const output = report([
      [
        anEmail({ id: emailId("a") }),
        outcome("a", "promotion", { reviewReason: "low_confidence" }),
      ],
      [anEmail({ id: emailId("b") }), outcome("b", "promotion")],
    ]);

    expect(output).toContain("would be cleaned (1)");
    expect(output).toContain("needs review (1)");
  });

  it("counts the cleanable categories instead of listing them", () => {
    const output = report([
      [anEmail({ id: emailId("a"), subject: "Sale one" }), outcome("a", "promotion")],
      [anEmail({ id: emailId("b"), subject: "Sale two" }), outcome("b", "promotion")],
      [anEmail({ id: emailId("c") }), outcome("c", "newsletter")],
    ]);

    expect(output).toContain("would be cleaned (3)");
    expect(output).toContain("promotion    2");
    expect(output).toContain("newsletter   1");
    expect(output).not.toContain("Sale one");
  });

  it("shows fyi as kept rather than cleaned", () => {
    const output = report([[anEmail({ id: emailId("a") }), outcome("a", "fyi")]]);

    expect(output).toContain("kept as is (1)");
    expect(output).not.toContain("would be cleaned");
  });

  it("accounts for every email, splitting rules from the model", () => {
    const ruleMatch = outcome("a", "promotion");
    const output = report([
      [
        anEmail({ id: emailId("a") }),
        {
          ...ruleMatch,
          classification: {
            category: "promotion",
            importance: 0.1,
            confidence: 0.9,
            reason: "Gmail marked it a promotion.",
            source: "rule",
            ruleId: "gmail_category_promotions",
          },
        },
      ],
      [anEmail({ id: emailId("b") }), outcome("b", "newsletter")],
      [
        anEmail({ id: emailId("c") }),
        outcome("c", undefined, { reviewReason: "invalid_model_output" }),
      ],
    ]);

    expect(output).toContain("classified    3");
    expect(output).toContain("by rules      1 (no model call)");
    expect(output).toContain("by model      1 (test-model)");
    expect(output).toContain("unreadable    1");
  });

  it("omits the unreadable line when everything parsed", () => {
    const output = report([[anEmail({ id: emailId("a") }), outcome("a", "fyi")]]);

    expect(output).not.toContain("unreadable");
  });

  it("always ends by saying the mailbox was not touched", () => {
    const output = report([[anEmail({ id: emailId("a") }), outcome("a", "fyi")]]);

    expect(output.trimEnd().endsWith("Nothing in your mailbox was changed.")).toBe(true);
  });

  it("never lets a crafted subject reach the terminal intact", () => {
    const output = report([
      [
        anEmail({ id: emailId("a"), subject: "Sale\u001b[2J\u001b[Hgotcha" }),
        outcome("a", "important"),
      ],
    ]);

    expect(output).not.toContain("\u001b");
  });
});

describe("the redacted report", () => {
  function redacted(pairs: readonly (readonly [Email, ClassificationOutcome])[]): string {
    return formatReport({
      emails: pairs.map(([email]) => email),
      outcomes: pairs.map(([, result]) => result),
      model: "test-model",
      redact: true,
    }).join("\n");
  }

  const SUBJECT = "Mortgage payment of 1,240.00 received";
  const SENDER = { address: "receipts@your-bank.example", name: "Your Bank" };

  it("prints no subject, no address and no model-written reason", () => {
    const output = redacted([
      [anEmail({ id: emailId("a"), subject: SUBJECT, from: SENDER }), outcome("a", "important")],
    ]);

    expect(output).not.toContain(SUBJECT);
    expect(output).not.toContain("Mortgage");
    expect(output).not.toContain("1,240.00");
    expect(output).not.toContain("receipts@your-bank.example");
    expect(output).not.toContain("Your Bank");
    // The reason is a paraphrase of the email, so it goes too.
    expect(output).not.toContain("Because it looks like");
  });

  it("still says what cleamail decided, and how", () => {
    const output = redacted([
      [anEmail({ id: emailId("a"), subject: SUBJECT, from: SENDER }), outcome("a", "important")],
    ]);

    expect(output).toContain("important");
    expect(output).toContain("0.90");
    expect(output).toContain("model");
    expect(output).toContain("classified    1");
  });

  it("numbers the rows so the mailbox owner can point at one", () => {
    const output = redacted([
      [anEmail({ id: emailId("a") }), outcome("a", "fyi")],
      [anEmail({ id: emailId("b") }), outcome("b", "promotion")],
    ]);

    expect(output).toContain("    1  ");
    expect(output).toContain("    2  ");
  });

  it("keeps the date, which is how the owner finds the email again", () => {
    const output = redacted([
      [
        anEmail({ id: emailId("a"), receivedAt: new Date("2026-10-18T09:30:00.000Z") }),
        outcome("a", "fyi"),
      ],
    ]);

    expect(output).toContain("2026-10-18 09:30");
  });

  it("marks review items and unreadable output without naming the email", () => {
    const output = redacted([
      [
        anEmail({ id: emailId("a"), subject: SUBJECT }),
        outcome("a", undefined, { reviewReason: "invalid_model_output" }),
      ],
    ]);

    expect(output).toContain("unreadable");
    expect(output).toContain("review:invalid_model_output");
    expect(output).not.toContain(SUBJECT);
  });

  it("says plainly what it is, so nobody mistakes it for the full report", () => {
    const output = redacted([[anEmail({ id: emailId("a") }), outcome("a", "fyi")]]);

    expect(output).toContain("no subjects, senders or reasons");
    expect(output.trimEnd().endsWith("Nothing in your mailbox was changed.")).toBe(true);
  });

  it("leaks nothing even when every field is hostile", () => {
    const output = redacted([
      [
        anEmail({
          id: emailId("SECRETID"),
          subject: "SECRETSUBJECT",
          snippet: "SECRETSNIPPET",
          bodyText: "SECRETBODY",
          from: { address: "SECRET@sender.example", name: "SECRETNAME" },
        }),
        outcome("a", "fyi"),
      ],
    ]);

    for (const leak of [
      "SECRETSUBJECT",
      "SECRETSNIPPET",
      "SECRETBODY",
      "SECRET@sender.example",
      "SECRETNAME",
    ]) {
      expect(output).not.toContain(leak);
    }
  });
});

describe("the full report, for contrast", () => {
  it("does show the subject and sender, which is exactly why --redact exists", () => {
    const output = report([
      [
        anEmail({
          id: emailId("a"),
          subject: "Mortgage payment received",
          from: { address: "receipts@your-bank.example", name: "Your Bank" },
        }),
        outcome("a", "important"),
      ],
    ]);

    expect(output).toContain("Mortgage payment received");
    expect(output).toContain("receipts@your-bank.example");
  });
});
