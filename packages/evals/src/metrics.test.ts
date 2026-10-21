import { describe, expect, it } from "vitest";
import type { Category } from "@cleamail/core";
import { computeMetrics, type CategoryMetrics } from "./metrics.js";
import type { GradedCase } from "./grade.js";

type Overrides = Partial<GradedCase>;

function graded(caseId: string, expected: Category, overrides: Overrides = {}): GradedCase {
  return {
    caseId,
    scenario: caseId,
    expected,
    verdict: "exact",
    violatedMustNot: false,
    dangerous: false,
    overCleaned: false,
    reviewed: false,
    latencyMs: 10,
    tags: [],
    ...overrides,
  };
}

/**
 * Eight cases with every outcome in them, small enough that every number below was worked out by
 * hand. A metrics test built from a hundred generated rows only proves the code agrees with itself.
 */
const CASES: readonly GradedCase[] = [
  graded("c1", "important", {
    scenario: "s-a",
    actual: "important",
    source: "model",
    latencyMs: 10,
  }),
  graded("c2", "important", {
    scenario: "s-a",
    actual: "important",
    source: "model",
    latencyMs: 20,
  }),
  graded("c3", "important", {
    actual: "promotion",
    verdict: "wrong",
    dangerous: true,
    source: "model",
    latencyMs: 30,
  }),
  // No source: the pipeline keeps no classification for invalid output, so nothing settled it.
  graded("c4", "important", {
    verdict: "unclassified",
    reviewed: true,
    reviewReason: "invalid_model_output",
    latencyMs: 40,
  }),
  graded("c5", "promotion", { actual: "promotion", source: "rule", latencyMs: 50 }),
  graded("c6", "promotion", {
    actual: "important",
    verdict: "wrong",
    violatedMustNot: true,
    source: "model",
    latencyMs: 60,
  }),
  graded("c7", "fyi", {
    actual: "promotion",
    verdict: "wrong",
    overCleaned: true,
    source: "model",
    latencyMs: 70,
  }),
  graded("c8", "notification", {
    actual: "fyi",
    verdict: "acceptable",
    source: "model",
    latencyMs: 80,
  }),
];

function metricsFor(category: Category): CategoryMetrics {
  const found = computeMetrics(CASES).categories.find((item) => item.category === category);
  if (found === undefined) throw new Error(`No metrics for ${category}.`);

  return found;
}

describe("computeMetrics", () => {
  it("counts each verdict", () => {
    expect(computeMetrics(CASES)).toMatchObject({
      total: 8,
      exact: 3,
      acceptable: 1,
      wrong: 3,
      unclassified: 1,
    });
  });

  it("counts accuracy with and without the defensible alternatives", () => {
    const metrics = computeMetrics(CASES);

    expect(metrics.accuracy).toBeCloseTo(0.5);
    expect(metrics.strictAccuracy).toBeCloseTo(0.375);
  });

  it("reports the scenarios behind the cases, not just the case count", () => {
    expect(computeMetrics(CASES).scenarios).toBe(7);
  });

  it("names the dangerous misses rather than only counting them", () => {
    const metrics = computeMetrics(CASES);

    expect(metrics.dangerous).toEqual(["c3"]);
    expect(metrics.dangerousRate).toBeCloseTo(0.125);
  });

  it("keeps over-cleaned fyi and must-not violations separate", () => {
    expect(computeMetrics(CASES).overCleaned).toEqual(["c7"]);
    expect(computeMetrics(CASES).mustNotViolations).toEqual(["c6"]);
  });

  it("splits what the rules settled from what the model settled", () => {
    const metrics = computeMetrics(CASES);

    expect(metrics.settledByRule).toBe(1);
    expect(metrics.settledByModel).toBe(6);
    // The unclassified case was settled by neither, which is why these do not add to the total.
    expect(metrics.settledByRule + metrics.settledByModel).toBe(7);
  });

  it("counts the review rate", () => {
    expect(computeMetrics(CASES).reviewed).toBe(1);
    expect(computeMetrics(CASES).reviewRate).toBeCloseTo(0.125);
  });

  it("computes precision and recall against the single expected label", () => {
    expect(metricsFor("important")).toMatchObject({ support: 4, predicted: 3, truePositives: 2 });
    expect(metricsFor("important").precision).toBeCloseTo(2 / 3);
    expect(metricsFor("important").recall).toBeCloseTo(0.5);
    expect(metricsFor("important").f1).toBeCloseTo(0.5714, 3);
  });

  it("counts an acceptable answer off the diagonal, since the matrix uses one label", () => {
    expect(metricsFor("notification").truePositives).toBe(0);
    expect(metricsFor("fyi").predicted).toBe(1);
  });

  it("leaves precision undefined when nothing was predicted, rather than scoring it zero", () => {
    expect(metricsFor("notification").predicted).toBe(0);
    expect(metricsFor("notification").precision).toBeUndefined();
    expect(metricsFor("notification").recall).toBeCloseTo(0);
  });

  it("leaves recall undefined when the set has no such case", () => {
    expect(metricsFor("newsletter")).toMatchObject({ support: 0, predicted: 0 });
    expect(metricsFor("newsletter").recall).toBeUndefined();
    expect(metricsFor("newsletter").f1).toBeUndefined();
  });

  it("builds a confusion row per true category, counting the unclassified separately", () => {
    const row = computeMetrics(CASES).confusion.find((item) => item.expected === "important");

    expect(row?.predicted.get("important")).toBe(2);
    expect(row?.predicted.get("promotion")).toBe(1);
    expect(row?.predicted.get("fyi")).toBeUndefined();
    expect(row?.unclassified).toBe(1);
  });

  it("measures latency by nearest rank", () => {
    expect(computeMetrics(CASES).latency).toEqual({
      meanMs: 45,
      p50Ms: 40,
      p95Ms: 80,
      maxMs: 80,
      totalMs: 360,
    });
  });

  it("groups the unclassified cases by what they failed on", () => {
    const reasons = computeMetrics([
      graded("x", "fyi", { verdict: "unclassified", reviewDetail: "Reasoning only." }),
      graded("y", "fyi", { verdict: "unclassified", reviewDetail: "Reasoning only." }),
      graded("z", "fyi", { verdict: "unclassified", reviewDetail: "Not JSON." }),
      graded("w", "fyi", { actual: "fyi" }),
    ]).unclassifiedReasons;

    expect([...reasons.entries()]).toEqual([
      ["Reasoning only.", 2],
      ["Not JSON.", 1],
    ]);
  });

  it("still accounts for an unclassified case that recorded no explanation", () => {
    const reasons = computeMetrics([
      graded("x", "fyi", { verdict: "unclassified" }),
    ]).unclassifiedReasons;

    expect([...reasons.values()]).toEqual([1]);
  });

  it("reports zeroes rather than dividing by nothing on an empty run", () => {
    const metrics = computeMetrics([]);

    expect(metrics.total).toBe(0);
    expect(metrics.accuracy).toBe(0);
    expect(metrics.dangerousRate).toBe(0);
    expect(metrics.latency.p95Ms).toBe(0);
  });
});
