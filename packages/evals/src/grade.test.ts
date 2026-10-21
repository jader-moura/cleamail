import { describe, expect, it } from "vitest";
import {
  ClassificationSchema,
  PolicySettingsSchema,
  emailId,
  type Category,
  type ClassificationOutcome,
  type Email,
  type PolicySettings,
  type ReviewReason,
} from "@cleamail/core";
import { EvalCaseSchema, type EvalCase } from "./case.js";
import { toEmail } from "./to-email.js";
import { gradeCase } from "./grade.js";

function evalCase(overrides: Partial<EvalCase> = {}): EvalCase {
  return EvalCaseSchema.parse({
    id: "case-1",
    scenario: "scenario-1",
    expect: "important",
    email: { from: { address: "someone@example.org" }, subject: "Hello" },
    ...overrides,
  });
}

function outcome(
  category: Category | undefined,
  options: {
    readonly reviewReason?: ReviewReason;
    readonly reviewDetail?: string;
    readonly source?: "rule" | "model";
    readonly ruleId?: string;
    readonly confidence?: number;
  } = {},
): ClassificationOutcome {
  return {
    emailId: emailId("case-1"),
    hints: [],
    ...(options.reviewReason === undefined ? {} : { reviewReason: options.reviewReason }),
    ...(options.reviewDetail === undefined ? {} : { reviewDetail: options.reviewDetail }),
    ...(category === undefined
      ? {}
      : {
          classification: ClassificationSchema.parse({
            category,
            importance: 0.5,
            confidence: options.confidence ?? 0.9,
            reason: "A reason.",
            source: options.source ?? "model",
            ...(options.ruleId === undefined ? {} : { ruleId: options.ruleId }),
          }),
        }),
  };
}

const NOW = new Date("2026-03-10T12:00:00.000Z");

/** The email behind every case here: in the inbox, unread, unstarred, from a sender on no list. */
function emailFor(evalCase: EvalCase): Email {
  return toEmail(evalCase, NOW);
}

/** Positional wrapper, so these tests read as "this case, this answer" rather than as plumbing. */
function judge(
  evalCase: EvalCase,
  outcome: ClassificationOutcome,
  latencyMs: number,
  settings?: PolicySettings,
) {
  return gradeCase({
    evalCase,
    email: emailFor(evalCase),
    outcome,
    latencyMs,
    ...(settings === undefined ? {} : { settings }),
    now: NOW,
  });
}

describe("gradeCase", () => {
  it("calls the expected category exact", () => {
    expect(judge(evalCase(), outcome("important"), 10).verdict).toBe("exact");
  });

  it("calls a defensible alternative acceptable rather than wrong", () => {
    const graded = judge(evalCase({ acceptable: ["needs_reply"] }), outcome("needs_reply"), 10);

    expect(graded.verdict).toBe("acceptable");
  });

  it("calls anything else wrong", () => {
    expect(judge(evalCase(), outcome("promotion"), 10).verdict).toBe("wrong");
  });

  it("calls a missing classification unclassified, not wrong", () => {
    const graded = judge(
      evalCase(),
      outcome(undefined, {
        reviewReason: "invalid_model_output",
        reviewDetail: "The model answered with reasoning only.",
      }),
      10,
    );

    expect(graded.verdict).toBe("unclassified");
    expect(graded.actual).toBeUndefined();
    expect(graded.reviewReason).toBe("invalid_model_output");
    expect(graded.reviewDetail).toBe("The model answered with reasoning only.");
    // The pipeline routes this to review, so nothing is acted on and nothing is lost.
    expect(graded.dangerous).toBe(false);
  });

  it("counts a protected email answered as noise as a dangerous miss", () => {
    expect(judge(evalCase(), outcome("promotion"), 10).dangerous).toBe(true);
  });

  it("does not count it when the pipeline sent it to review first", () => {
    const graded = judge(
      evalCase(),
      outcome("promotion", { reviewReason: "low_confidence", confidence: 0.3 }),
      10,
    );

    // Still wrong, but it is sitting in cleamail/Review where the user can see it.
    expect(graded.verdict).toBe("wrong");
    expect(graded.dangerous).toBe(false);
    expect(graded.reviewed).toBe(true);
  });

  it("counts a missed needs_reply and a missed suspicious as dangerous too", () => {
    for (const expected of ["needs_reply", "suspicious"] as const) {
      expect(judge(evalCase({ expect: expected }), outcome("newsletter"), 10).dangerous).toBe(true);
    }
  });

  it("does not call a wrongly kept promotion dangerous", () => {
    // Costs the user a glance, not a message.
    const graded = judge(evalCase({ expect: "promotion" }), outcome("important"), 10);

    expect(graded.verdict).toBe("wrong");
    expect(graded.dangerous).toBe(false);
    expect(graded.overCleaned).toBe(false);
  });

  it("calls nothing dangerous when archiving is off, because nothing is removed", () => {
    const labelOnly = PolicySettingsSchema.parse({ archiveCleaned: false });

    expect(judge(evalCase(), outcome("promotion"), 10, labelOnly).dangerous).toBe(false);
    // Still a wrong answer. It just would not have cost the user the email.
    expect(judge(evalCase(), outcome("promotion"), 10, labelOnly).verdict).toBe("wrong");
  });

  it("calls nothing dangerous for a sender on the allowlist", () => {
    const allowed = PolicySettingsSchema.parse({ allowlist: ["example.org"] });

    expect(judge(evalCase(), outcome("promotion"), 10, allowed).dangerous).toBe(false);
  });

  it("separates an over-cleaned fyi from a dangerous miss", () => {
    const graded = judge(evalCase({ expect: "fyi" }), outcome("promotion"), 10);

    expect(graded.overCleaned).toBe(true);
    expect(graded.dangerous).toBe(false);
  });

  it("flags a forbidden answer even when it is only the second-best label", () => {
    const graded = judge(
      evalCase({ expect: "promotion", mustNot: ["important"] }),
      outcome("important"),
      10,
    );

    expect(graded.violatedMustNot).toBe(true);
  });

  it("carries the rule id through when a rule decided", () => {
    const graded = judge(
      evalCase({ expect: "promotion" }),
      outcome("promotion", { source: "rule", ruleId: "gmail_category_promotions" }),
      10,
    );

    expect(graded.source).toBe("rule");
    expect(graded.ruleId).toBe("gmail_category_promotions");
  });

  it("keeps the case id, scenario, tags and latency for the report", () => {
    const graded = judge(evalCase({ tags: ["injection"] }), outcome("important"), 42);

    expect(graded).toMatchObject({
      caseId: "case-1",
      scenario: "scenario-1",
      tags: ["injection"],
      latencyMs: 42,
    });
  });
});
