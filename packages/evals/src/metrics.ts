import { CATEGORIES, type Category } from "@cleamail/core";
import type { GradedCase } from "./grade.js";

export type CategoryMetrics = {
  readonly category: Category;
  /** How many cases truly are this category. */
  readonly support: number;
  /** How many cases were answered as this category. */
  readonly predicted: number;
  readonly truePositives: number;
  /** Absent when nothing was predicted as this category, which is not the same as scoring zero. */
  readonly precision?: number;
  /** Absent when the set contains no case of this category. */
  readonly recall?: number;
  readonly f1?: number;
};

export type ConfusionRow = {
  readonly expected: Category;
  readonly predicted: ReadonlyMap<Category, number>;
  readonly unclassified: number;
};

export type LatencyMetrics = {
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  readonly totalMs: number;
};

export type EvalMetrics = {
  readonly total: number;
  /** Distinct scenarios behind those cases. The honest measure of how varied the set is. */
  readonly scenarios: number;
  readonly exact: number;
  readonly acceptable: number;
  readonly wrong: number;
  readonly unclassified: number;
  /** Exact and acceptable answers over the total. */
  readonly accuracy: number;
  /** Exact answers only, for comparing against a run that allowed no alternatives. */
  readonly strictAccuracy: number;
  /** Ids, not just a count: a safety number nobody can look into is not actionable. */
  readonly dangerous: readonly string[];
  readonly dangerousRate: number;
  readonly overCleaned: readonly string[];
  readonly mustNotViolations: readonly string[];
  readonly reviewed: number;
  readonly reviewRate: number;
  readonly settledByRule: number;
  readonly settledByModel: number;
  /**
   * What the unclassified cases failed on, and how many hit each.
   *
   * The first run of this eval reported 17 of 20 unclassified and said nothing about why, which
   * took three throwaway scripts to work out. One line per distinct explanation fixes that.
   */
  readonly unclassifiedReasons: ReadonlyMap<string, number>;
  readonly categories: readonly CategoryMetrics[];
  readonly confusion: readonly ConfusionRow[];
  readonly latency: LatencyMetrics;
};

/**
 * Turns graded cases into the numbers.
 *
 * Precision, recall and the matrix use each case's single `expect` label, so an answer that was
 * defensible but not the expected one lands off the diagonal. `accuracy` counts it as correct. Both
 * are reported because they answer different questions: one is "how good is this classifier at
 * agreeing with a specific label", the other is "how often would a user think it got it right".
 */
export function computeMetrics(graded: readonly GradedCase[]): EvalMetrics {
  const total = graded.length;
  const latencies = graded.map((item) => item.latencyMs).sort((a, b) => a - b);
  const totalMs = latencies.reduce((sum, value) => sum + value, 0);

  const exact = graded.filter((item) => item.verdict === "exact").length;
  const acceptable = graded.filter((item) => item.verdict === "acceptable").length;
  const dangerous = graded.filter((item) => item.dangerous).map((item) => item.caseId);
  const reviewed = graded.filter((item) => item.reviewed).length;

  return {
    total,
    scenarios: new Set(graded.map((item) => item.scenario)).size,
    exact,
    acceptable,
    wrong: graded.filter((item) => item.verdict === "wrong").length,
    unclassified: graded.filter((item) => item.verdict === "unclassified").length,
    accuracy: rate(exact + acceptable, total),
    strictAccuracy: rate(exact, total),
    dangerous,
    dangerousRate: rate(dangerous.length, total),
    overCleaned: graded.filter((item) => item.overCleaned).map((item) => item.caseId),
    mustNotViolations: graded.filter((item) => item.violatedMustNot).map((item) => item.caseId),
    reviewed,
    reviewRate: rate(reviewed, total),
    settledByRule: graded.filter((item) => item.source === "rule").length,
    settledByModel: graded.filter((item) => item.source === "model").length,
    unclassifiedReasons: unclassifiedReasons(graded),
    categories: CATEGORIES.map((category) => categoryMetrics(graded, category)),
    confusion: CATEGORIES.map((category) => confusionRow(graded, category)),
    latency: {
      meanMs: total === 0 ? 0 : totalMs / total,
      p50Ms: percentile(latencies, 0.5),
      p95Ms: percentile(latencies, 0.95),
      maxMs: latencies.at(-1) ?? 0,
      totalMs,
    },
  };
}

function categoryMetrics(graded: readonly GradedCase[], category: Category): CategoryMetrics {
  const support = graded.filter((item) => item.expected === category).length;
  const predicted = graded.filter((item) => item.actual === category).length;
  const truePositives = graded.filter(
    (item) => item.expected === category && item.actual === category,
  ).length;

  const precision = predicted === 0 ? undefined : truePositives / predicted;
  const recall = support === 0 ? undefined : truePositives / support;

  return {
    category,
    support,
    predicted,
    truePositives,
    ...(precision === undefined ? {} : { precision }),
    ...(recall === undefined ? {} : { recall }),
    ...(precision === undefined || recall === undefined || precision + recall === 0
      ? {}
      : { f1: (2 * precision * recall) / (precision + recall) }),
  };
}

function confusionRow(graded: readonly GradedCase[], expected: Category): ConfusionRow {
  const row = graded.filter((item) => item.expected === expected);
  const predicted = new Map<Category, number>();

  for (const category of CATEGORIES) {
    const count = row.filter((item) => item.actual === category).length;
    if (count > 0) predicted.set(category, count);
  }

  return {
    expected,
    predicted,
    unclassified: row.filter((item) => item.actual === undefined).length,
  };
}

function unclassifiedReasons(graded: readonly GradedCase[]): ReadonlyMap<string, number> {
  const reasons = new Map<string, number>();

  for (const item of graded) {
    if (item.verdict !== "unclassified") continue;

    const reason = item.reviewDetail ?? "No explanation was recorded.";

    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }

  return reasons;
}

function rate(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

/** Nearest-rank percentile. With 300 samples there is no reason to interpolate. */
function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;

  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));

  return sorted[index] ?? 0;
}
