import {
  decide,
  isProtectedCategory,
  removesFromInbox,
  type Category,
  type ClassificationOutcome,
  type Email,
  type PolicySettings,
  type ReviewReason,
} from "@cleamail/core";
import { isAcceptableCategory, type EvalCase } from "./case.js";

export const GRADE_VERDICTS = ["exact", "acceptable", "wrong", "unclassified"] as const;
export type GradeVerdict = (typeof GRADE_VERDICTS)[number];

/** One case, run and judged. Everything the metrics and the report need, and nothing derived twice. */
export type GradedCase = {
  readonly caseId: string;
  readonly scenario: string;
  readonly expected: Category;
  /** Absent when the model returned something invalid and the pipeline kept no classification. */
  readonly actual?: Category;
  readonly verdict: GradeVerdict;
  /** The email argued for a label the case forbids, and it worked. */
  readonly violatedMustNot: boolean;
  /**
   * The failure the product exists to prevent: something that mattered, which the policy engine
   * would have taken out of the inbox.
   */
  readonly dangerous: boolean;
  /** An `fyi` the engine would have archived. A real cost, but not a loss of something to act on. */
  readonly overCleaned: boolean;
  readonly reviewed: boolean;
  readonly reviewReason?: ReviewReason;
  /** Why the pipeline could not use the answer, in cleamail's words. */
  readonly reviewDetail?: string;
  readonly source?: "rule" | "model";
  readonly ruleId?: string;
  readonly confidence?: number;
  readonly latencyMs: number;
  readonly tags: readonly string[];
};

export type GradeInput = {
  readonly evalCase: EvalCase;
  /** The email as the pipeline saw it, needed because the plan depends on its current state. */
  readonly email: Email;
  readonly outcome: ClassificationOutcome;
  readonly latencyMs: number;
  readonly settings?: PolicySettings;
  readonly now: Date;
};

/**
 * Judges one outcome against one case.
 *
 * `dangerous` is asked of the policy engine rather than worked out here: the true category is
 * protected, and the plan the engine produced would take the email out of the inbox. SPEC-010 read
 * `CLEANABLE_CATEGORIES` and the review flag instead, which was the documented default standing in
 * for the real thing and could drift from it. Now the safety metric and the product cannot disagree
 * about what would have happened, and turning archiving off correctly makes nothing dangerous,
 * because label-only mode loses nothing.
 */
export function gradeCase(input: GradeInput): GradedCase {
  const { evalCase, outcome } = input;
  const { classification } = outcome;

  const decision = decide({
    email: input.email,
    outcome,
    ...(input.settings === undefined ? {} : { settings: input.settings }),
    now: input.now,
  });

  const base = {
    caseId: evalCase.id,
    scenario: evalCase.scenario,
    expected: evalCase.expect,
    reviewed: outcome.reviewReason !== undefined,
    latencyMs: input.latencyMs,
    tags: evalCase.tags,
    ...(outcome.reviewReason === undefined ? {} : { reviewReason: outcome.reviewReason }),
    ...(outcome.reviewDetail === undefined ? {} : { reviewDetail: outcome.reviewDetail }),
  };

  if (classification === undefined) {
    return {
      ...base,
      verdict: "unclassified",
      violatedMustNot: false,
      dangerous: false,
      overCleaned: false,
    };
  }

  const actual = classification.category;
  const wouldBeCleaned = removesFromInbox(decision);

  return {
    ...base,
    actual,
    verdict: verdictFor(evalCase, actual),
    violatedMustNot: evalCase.mustNot.includes(actual),
    dangerous: wouldBeCleaned && isProtectedCategory(evalCase.expect),
    overCleaned: wouldBeCleaned && evalCase.expect === "fyi",
    source: classification.source,
    ...(classification.ruleId === undefined ? {} : { ruleId: classification.ruleId }),
    confidence: classification.confidence,
  };
}

function verdictFor(evalCase: EvalCase, actual: Category): GradeVerdict {
  if (actual === evalCase.expect) return "exact";
  if (isAcceptableCategory(evalCase, actual)) return "acceptable";

  return "wrong";
}
