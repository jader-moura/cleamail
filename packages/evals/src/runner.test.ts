import { describe, expect, it } from "vitest";
import { PolicySettingsSchema } from "@cleamail/core";
import { EvalCaseSchema, type EvalCase } from "./case.js";
import { runEval } from "./runner.js";
import { ScriptedClassifier } from "./test/classifier.js";

const NOW = new Date("2026-03-10T12:00:00.000Z");

/** Advances five milliseconds per reading, so latency is asserted rather than waited for. */
function fakeClock(): () => number {
  let value = 0;

  return () => {
    value += 5;

    return value;
  };
}

/** The email is merged rather than replaced, so a case can change one field of it. */
type CaseOverrides = Omit<Partial<EvalCase>, "email"> & {
  readonly email?: Partial<EvalCase["email"]>;
};

function evalCase(id: string, overrides: CaseOverrides = {}): EvalCase {
  const { email, ...rest } = overrides;

  return EvalCaseSchema.parse({
    id,
    scenario: `scenario-${id}`,
    expect: "important",
    ...rest,
    email: {
      from: { address: "someone@example.org", name: "Someone" },
      to: [{ address: "you@example.com" }],
      subject: "Hello",
      body: "A message.",
      ...email,
    },
  });
}

describe("runEval", () => {
  it("runs the real pipeline, so a terminal rule settles a case without the model", async () => {
    const promotion = evalCase("promo", {
      expect: "promotion",
      email: {
        from: { address: "offers@shop.example" },
        subject: "Sale",
        body: "Everything reduced.",
        providerLabels: ["INBOX", "CATEGORY_PROMOTIONS"],
      },
    });

    const classifier = new ScriptedClassifier({ direct: "important" });
    const run = await runEval({
      cases: [promotion, evalCase("direct")],
      classifier,
      now: NOW,
      elapsed: fakeClock(),
    });

    expect(run.ok).toBe(true);
    expect(classifier.seen).toEqual(["direct"]);

    const [first] = run.ok ? run.value.graded : [];

    expect(first).toMatchObject({
      caseId: "promo",
      verdict: "exact",
      source: "rule",
      ruleId: "gmail_category_promotions",
    });
  });

  it("grades what the model answered", async () => {
    const run = await runEval({
      cases: [evalCase("a"), evalCase("b", { expect: "newsletter" })],
      classifier: new ScriptedClassifier({ a: "important", b: "promotion" }),
      now: NOW,
      elapsed: fakeClock(),
    });

    expect(run.ok && run.value.graded.map((item) => item.verdict)).toEqual(["exact", "wrong"]);
    expect(run.ok && run.value.metrics.total).toBe(2);
  });

  it("turns invalid model output into an unclassified case and carries on", async () => {
    const run = await runEval({
      cases: [evalCase("a"), evalCase("b")],
      classifier: new ScriptedClassifier({ a: { fail: "invalid_model_output" }, b: "important" }),
      now: NOW,
      elapsed: fakeClock(),
    });

    expect(run.ok && run.value.graded.map((item) => item.verdict)).toEqual([
      "unclassified",
      "exact",
    ]);
  });

  it("stops at the first failure that is not about one email, and names the case", async () => {
    const run = await runEval({
      cases: [evalCase("a"), evalCase("b")],
      classifier: new ScriptedClassifier({ a: { fail: "provider_unavailable" } }),
      now: NOW,
      elapsed: fakeClock(),
    });

    expect(run.ok).toBe(false);
    expect(!run.ok && run.error.code).toBe("provider_unavailable");
    expect(!run.ok && run.error.message).toContain("case a");
  });

  it("sends a low-confidence answer to review instead of counting it as acted on", async () => {
    const run = await runEval({
      cases: [evalCase("a")],
      classifier: new ScriptedClassifier({ a: { category: "promotion", confidence: 0.2 } }),
      now: NOW,
      elapsed: fakeClock(),
    });

    const [first] = run.ok ? run.value.graded : [];

    expect(first).toMatchObject({
      reviewed: true,
      reviewReason: "low_confidence",
      dangerous: false,
    });
  });

  it("classifies by the threshold in the settings, so the run cannot report another", async () => {
    const run = await runEval({
      cases: [evalCase("a")],
      classifier: new ScriptedClassifier({ a: { category: "important", confidence: 0.5 } }),
      now: NOW,
      settings: PolicySettingsSchema.parse({ confidenceThreshold: 0.4 }),
      elapsed: fakeClock(),
    });

    expect(run.ok && run.value.settings.confidenceThreshold).toBe(0.4);
    expect(run.ok && run.value.graded[0]?.reviewed).toBe(false);
  });

  it("defaults to the threshold the prompt tells the model about", async () => {
    const run = await runEval({
      cases: [evalCase("a")],
      classifier: new ScriptedClassifier({ a: { category: "important", confidence: 0.5 } }),
      now: NOW,
      elapsed: fakeClock(),
    });

    expect(run.ok && run.value.settings.confidenceThreshold).toBe(0.6);
    // 0.5 is under the default, so the same answer that passed above goes to review here.
    expect(run.ok && run.value.graded[0]?.reviewed).toBe(true);
  });

  it("measures each case and reports the model it used", async () => {
    const run = await runEval({
      cases: [evalCase("a"), evalCase("b")],
      classifier: new ScriptedClassifier({}),
      now: NOW,
      elapsed: fakeClock(),
    });

    expect(run.ok && run.value.model).toBe("scripted");
    expect(run.ok && run.value.graded.map((item) => item.latencyMs)).toEqual([5, 5]);
  });

  it("reports progress in order", async () => {
    const seen: string[] = [];

    await runEval({
      cases: [evalCase("a"), evalCase("b"), evalCase("c")],
      classifier: new ScriptedClassifier({}),
      now: NOW,
      elapsed: fakeClock(),
      onProgress: (done, total) => {
        seen.push(`${String(done)}/${String(total)}`);
      },
    });

    expect(seen).toEqual(["1/3", "2/3", "3/3"]);
  });
});
