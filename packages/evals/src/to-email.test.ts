import { describe, expect, it } from "vitest";
import { EvalCaseSchema, type EvalCase } from "./case.js";
import { EVAL_ACCOUNT_ID, toEmail } from "./to-email.js";

const NOW = new Date("2026-03-10T12:00:00.000Z");

function evalCase(overrides: Partial<EvalCase["email"]> = {}): EvalCase {
  return EvalCaseSchema.parse({
    id: "case-1",
    scenario: "scenario-1",
    expect: "newsletter",
    email: {
      from: { address: "news@shop.example", name: "Shop" },
      to: [{ address: "you@example.com" }],
      subject: "Spring sale",
      body: "Everything must go.",
      ageHours: 5,
      ...overrides,
    },
  });
}

describe("toEmail", () => {
  it("dates the email relative to the run clock", () => {
    expect(toEmail(evalCase(), NOW).receivedAt).toEqual(new Date("2026-03-10T07:00:00.000Z"));
  });

  it("derives the snippet from the body, as a provider would", () => {
    expect(toEmail(evalCase(), NOW).snippet).toBe("Everything must go.");
  });

  it("collapses whitespace and truncates a long snippet", () => {
    const email = toEmail(evalCase({ body: `${"word ".repeat(60)}end` }), NOW);

    expect(email.snippet).not.toContain("  ");
    expect(email.snippet.endsWith("...")).toBe(true);
    expect(email.snippet.length).toBeLessThanOrEqual(143);
  });

  it("keeps the body whole, so the classifier sees what the case wrote", () => {
    expect(toEmail(evalCase(), NOW).bodyText).toBe("Everything must go.");
  });

  it("puts every case in one inbox, unread and unstarred", () => {
    const email = toEmail(evalCase(), NOW);

    expect(email.accountId).toBe(EVAL_ACCOUNT_ID);
    expect(email.isInInbox).toBe(true);
    expect(email.isRead).toBe(false);
    expect(email.isStarred).toBe(false);
  });

  it("derives ids from the case id, so a failure names a case", () => {
    const email = toEmail(evalCase(), NOW);

    expect(String(email.id)).toBe("case-1");
    expect(String(email.threadId)).toBe("thread-case-1");
  });

  it("measures the size in bytes rather than characters", () => {
    expect(toEmail(evalCase({ body: "café" }), NOW).sizeBytes).toBe(6);
  });
});
