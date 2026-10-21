import {
  isCleanableCategory,
  isProtectedCategory,
  type Category,
  type ClassificationOutcome,
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
   * The failure the product exists to prevent: something that mattered, classified as noise, with
   * nothing routing it to a human first.
   */
  readonly dangerous: boolean;
  /** An `fyi` that would have been archived. A real cost, but not a loss of something to act on. */
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

/**
 * Judges one outcome against one case.
 *
 * `dangerous` is the narrow definition SPEC-010 settled on: the true category is protected, the
 * answer was a cleanable one, and the pipeline did not route it to review. The last clause matters,
 * because an email sitting in `cleamail/Review` has not been archived and the user still sees it.
 * Counting it as a loss would make the safety number pessimistic in the one direction that would
 * push someone to loosen the review threshold.
 */
export function gradeCase(
  evalCase: EvalCase,
  outcome: ClassificationOutcome,
  latencyMs: number,
): GradedCase {
  const { classification } = outcome;
  const reviewed = outcome.reviewReason !== undefined;

  const base = {
    caseId: evalCase.id,
    scenario: evalCase.scenario,
    expected: evalCase.expect,
    reviewed,
    latencyMs,
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
  const wouldBeCleaned = isCleanableCategory(actual) && !reviewed;

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
