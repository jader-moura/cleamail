import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY_SETTINGS, type Category } from "@cleamail/core";
import { computeMetrics } from "./metrics.js";
import { DANGEROUS_TARGET, formatEvalReport } from "./report.js";
import type { GradedCase } from "./grade.js";
import type { EvalRun } from "./runner.js";

/**
 * `unclassified` leaves `actual` off the object entirely, which is the shape the pipeline produces
 * when the model answered with something invalid. Passing `actual: undefined` cannot express that
 * under `exactOptionalPropertyTypes`.
 */
type Overrides = Partial<GradedCase> & { readonly unclassified?: boolean };

function graded(caseId: string, expected: Category, overrides: Overrides = {}): GradedCase {
  const { unclassified, ...rest } = overrides;

  return {
    caseId,
    scenario: caseId,
    expected,
    ...(unclassified === true ? {} : { actual: expected }),
    verdict: "exact",
    violatedMustNot: false,
    dangerous: false,
    overCleaned: false,
    reviewed: false,
    source: "model",
    latencyMs: 1500,
    tags: [],
    ...rest,
  };
}

function run(cases: readonly GradedCase[]): EvalRun {
  return {
    model: "qwen2.5:7b",
    startedAt: new Date("2026-03-10T12:00:00.000Z"),
    threshold: 0.6,
    settings: DEFAULT_POLICY_SETTINGS,
    graded: cases,
    metrics: computeMetrics(cases),
  };
}

const CLEAN = [graded("a", "important"), graded("b", "promotion")];

function report(cases: readonly GradedCase[]): string {
  return formatEvalReport(run(cases)).join("\n");
}

describe("formatEvalReport", () => {
  it("names the model, the case count and the scenario count", () => {
    const text = report(CLEAN);

    expect(text).toContain("qwen2.5:7b");
    expect(text).toContain("2 from 2 scenario(s)");
    expect(text).toContain("0.60");
  });

  it("leads with safety, before accuracy", () => {
    const lines = formatEvalReport(run(CLEAN));

    expect(lines.indexOf("Safety")).toBeLessThan(lines.indexOf("Accuracy"));
  });

  it("says it is within the target when nothing dangerous happened", () => {
    expect(report(CLEAN)).toContain("Within the target.");
  });

  it("says plainly when the rate is over the target", () => {
    const text = report([
      graded("a", "important", { actual: "promotion", verdict: "wrong", dangerous: true }),
      ...CLEAN,
    ]);

    expect(text).toContain("Over the target.");
    expect(text).toContain("Nothing should act on an inbox at this rate.");
  });

  it("lists the dangerous cases by id", () => {
    const text = report([
      graded("missed-invoice-01", "important", {
        actual: "promotion",
        verdict: "wrong",
        dangerous: true,
      }),
    ]);

    expect(text).toContain("missed-invoice-01");
  });

  it("summarizes the rest rather than printing a hundred ids", () => {
    const many = Array.from({ length: 15 }, (_unused, index) =>
      graded(`case-${String(index)}`, "important", {
        actual: "promotion",
        verdict: "wrong",
        dangerous: true,
      }),
    );

    expect(report(many)).toContain("and 3 more");
  });

  it("prints the target it is judging against", () => {
    expect(report(CLEAN)).toContain(`target under ${String(DANGEROUS_TARGET * 100)}`);
  });

  it("shows counts with their share", () => {
    expect(report(CLEAN)).toMatch(/exact\s+2\s+100\.0%/);
  });

  it("prints a dash where precision cannot be computed, rather than a zero", () => {
    expect(report(CLEAN)).toMatch(/suspicious\s+0\s+0\s+-\s+-\s+-/);
  });

  it("prints a confusion row per true category and says when it had no cases", () => {
    const text = report(CLEAN);

    expect(text).toContain("important   -> important 1");
    expect(text).toContain("newsletter  -> no cases");
  });

  it("names the unclassified cases in the confusion rows", () => {
    const text = report([
      graded("a", "important", { unclassified: true, verdict: "unclassified" }),
    ]);

    expect(text).toContain("important   -> none 1");
  });

  it("says why cases could not be classified, most common first", () => {
    const text = report([
      graded("a", "important", {
        unclassified: true,
        verdict: "unclassified",
        reviewDetail: "Not JSON.",
      }),
      graded("b", "important", {
        unclassified: true,
        verdict: "unclassified",
        reviewDetail: "Reasoning only.",
      }),
      graded("c", "important", {
        unclassified: true,
        verdict: "unclassified",
        reviewDetail: "Reasoning only.",
      }),
    ]);

    expect(text).toContain("Why cases could not be classified");
    expect(text.indexOf("Reasoning only.")).toBeLessThan(text.indexOf("Not JSON."));
  });

  it("leaves that section out when everything was classified", () => {
    expect(report(CLEAN)).not.toContain("Why cases could not be classified");
  });

  it("formats latency in units a person reads", () => {
    const text = report([
      graded("a", "important", { latencyMs: 400 }),
      graded("b", "important", { latencyMs: 90_000 }),
    ]);

    expect(text).toContain("p50    400ms");
    expect(text).toContain("total  1m 30s");
  });

  it("emits no control characters, since the ids come from a file on disk", () => {
    for (const line of formatEvalReport(run(CLEAN))) {
      // eslint-disable-next-line no-control-regex
      expect(line).not.toMatch(/[\u0000-\u001f\u007f]/);
    }
  });
});
