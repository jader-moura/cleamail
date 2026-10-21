import { describe, expect, it } from "vitest";
import { CATEGORIES, isProtectedCategory, type Category } from "../domain/category.js";
import { ClassificationSchema, type Classification } from "../domain/classification.js";
import { REVIEW_REASONS, type ReviewReason } from "../domain/decision.js";
import { EmailSchema, type Email } from "../domain/email.js";
import { LABEL_CLEANED, LABEL_REVIEW, LABEL_SUSPICIOUS } from "../domain/labels.js";
import { isNoOp, type Action } from "../domain/action.js";
import type { ClassificationOutcome } from "../pipeline/classify.js";
import { POLICY_VERSION, decide, explainDecision, removesFromInbox } from "./decide.js";
import { DEFAULT_POLICY_SETTINGS, PolicySettingsSchema, type PolicySettings } from "./settings.js";

const NOW = new Date("2026-03-10T12:00:00.000Z");

function email(overrides: Partial<Email> = {}): Email {
  return EmailSchema.parse({
    id: "msg-1",
    threadId: "thread-1",
    accountId: "account-1",
    from: { address: "news@shop.example", name: "Shop" },
    to: [{ address: "you@example.com" }],
    subject: "Spring sale",
    isRead: false,
    isStarred: false,
    isInInbox: true,
    receivedAt: NOW,
    ...overrides,
  });
}

function classification(category: Category, confidence = 0.9): Classification {
  return ClassificationSchema.parse({
    category,
    importance: 0.5,
    confidence,
    reason: `It reads like ${category.replace("_", " ")}.`,
    source: "model",
    model: "test",
  });
}

function outcome(
  category: Category | undefined,
  reviewReason?: ReviewReason,
): ClassificationOutcome {
  return {
    emailId: email().id,
    hints: [],
    ...(category === undefined ? {} : { classification: classification(category) }),
    ...(reviewReason === undefined ? {} : { reviewReason }),
  };
}

function actionsFor(
  category: Category | undefined,
  options: {
    readonly reviewReason?: ReviewReason;
    readonly settings?: PolicySettings;
    readonly email?: Email;
  } = {},
): readonly Action[] {
  return decide({
    email: options.email ?? email(),
    outcome: outcome(category, options.reviewReason),
    ...(options.settings === undefined ? {} : { settings: options.settings }),
    now: NOW,
  }).actions;
}

function types(actions: readonly Action[]): readonly string[] {
  return actions.map((action) => (action.type === "label" ? `label:${action.label}` : action.type));
}

describe("decide, on the documented defaults", () => {
  it.each([
    ["important", ["star"]],
    ["needs_reply", ["star"]],
    ["fyi", []],
    ["newsletter", [`label:${LABEL_CLEANED}`, "archive"]],
    ["promotion", [`label:${LABEL_CLEANED}`, "archive"]],
    ["notification", [`label:${LABEL_CLEANED}`, "archive"]],
    ["suspicious", [`label:${LABEL_SUSPICIOUS}`]],
  ] as const)("plans %s as the policy in CLAUDE.md says", (category, expected) => {
    expect(types(actionsFor(category))).toEqual(expected);
  });

  it("does nothing at all for fyi, which is the decision rather than a gap", () => {
    expect(actionsFor("fyi")).toEqual([]);
  });

  it.each(CATEGORIES)(
    "labels %s for review when the outcome says to, except suspicious",
    (category) => {
      const planned = types(actionsFor(category, { reviewReason: "low_confidence" }));

      expect(planned).toEqual(
        category === "suspicious" ? [`label:${LABEL_SUSPICIOUS}`] : [`label:${LABEL_REVIEW}`],
      );
    },
  );

  it("labels an unclassifiable email for review and stops", () => {
    expect(types(actionsFor(undefined, { reviewReason: "invalid_model_output" }))).toEqual([
      `label:${LABEL_REVIEW}`,
    ]);
  });

  it("gives suspicious its own label whether or not the review reason came with it", () => {
    expect(types(actionsFor("suspicious"))).toEqual([`label:${LABEL_SUSPICIOUS}`]);
    expect(types(actionsFor("suspicious", { reviewReason: "suspicious" }))).toEqual([
      `label:${LABEL_SUSPICIOUS}`,
    ]);
  });
});

describe("decide, across every input", () => {
  const states: readonly Email[] = [
    email(),
    email({ isStarred: true }),
    email({ isInInbox: false }),
    email({ isRead: true }),
    email({ providerLabels: ["INBOX", LABEL_CLEANED] }),
  ];

  const settingsSet: readonly PolicySettings[] = [
    DEFAULT_POLICY_SETTINGS,
    PolicySettingsSchema.parse({ archiveCleaned: false }),
    PolicySettingsSchema.parse({ markCleanedRead: true }),
    PolicySettingsSchema.parse({ starImportant: false }),
    PolicySettingsSchema.parse({ allowlist: ["shop.example"] }),
  ];

  const reviewStates: readonly (ReviewReason | undefined)[] = [undefined, ...REVIEW_REASONS];

  /** Every category, every review state, every email state, every setting. */
  function everyPlan(): readonly { readonly label: string; readonly actions: readonly Action[] }[] {
    const plans: { label: string; actions: readonly Action[] }[] = [];

    for (const category of [...CATEGORIES, undefined]) {
      for (const reviewReason of reviewStates) {
        for (const state of states) {
          for (const settings of settingsSet) {
            plans.push({
              label: `${String(category)}/${String(reviewReason)}/${JSON.stringify(settings)}`,
              actions: actionsFor(category, {
                ...(reviewReason === undefined ? {} : { reviewReason }),
                settings,
                email: state,
              }),
            });
          }
        }
      }
    }

    return plans;
  }

  it("covers a meaningful number of combinations", () => {
    // Guards the guard: an empty enumeration would make everything below pass for free.
    expect(everyPlan().length).toBe(8 * 4 * 5 * 5);
  });

  it("never produces a trash action, which only SPEC-016 may reach", () => {
    for (const plan of everyPlan()) {
      expect(
        plan.actions.some((action) => action.type === "trash"),
        plan.label,
      ).toBe(false);
    }
  });

  it("never archives a protected category", () => {
    for (const category of CATEGORIES.filter(isProtectedCategory)) {
      for (const reviewReason of reviewStates) {
        for (const state of states) {
          for (const settings of settingsSet) {
            const planned = types(
              actionsFor(category, {
                ...(reviewReason === undefined ? {} : { reviewReason }),
                settings,
                email: state,
              }),
            );

            expect(planned, `${category}/${String(reviewReason)}`).not.toContain("archive");
          }
        }
      }
    }
  });

  it("plans at most one label per email", () => {
    for (const plan of everyPlan()) {
      const labels = plan.actions.filter((action) => action.type === "label");

      expect(labels.length, plan.label).toBeLessThanOrEqual(1);
    }
  });

  it("records the state needed to reverse every action it plans", () => {
    for (const plan of everyPlan()) {
      for (const action of plan.actions) {
        // `isNoOp` reads the recorded state, so it answering at all proves the state is there.
        expect(typeof isNoOp(action), plan.label).toBe("boolean");
      }
    }
  });
});

describe("the safety overrides", () => {
  it("never cleans an allowlisted sender, whatever the classification says", () => {
    const settings = PolicySettingsSchema.parse({ allowlist: ["shop.example"] });

    expect(actionsFor("promotion", { settings })).toEqual([]);
    expect(actionsFor("newsletter", { settings })).toEqual([]);
  });

  it("matches the allowlist by bare domain and by full address", () => {
    for (const entry of ["shop.example", "news@shop.example", "@shop.example"]) {
      const settings = PolicySettingsSchema.parse({ allowlist: [entry] });

      expect(actionsFor("promotion", { settings }), entry).toEqual([]);
    }
  });

  it("never cleans a message the user starred", () => {
    expect(actionsFor("promotion", { email: email({ isStarred: true }) })).toEqual([]);
  });

  it("still stars what matters for an allowlisted sender, because a star hides nothing", () => {
    const settings = PolicySettingsSchema.parse({ allowlist: ["shop.example"] });

    expect(types(actionsFor("important", { settings }))).toEqual(["star"]);
  });

  it("still labels for review, because a review label hides nothing either", () => {
    const settings = PolicySettingsSchema.parse({ allowlist: ["shop.example"] });

    expect(types(actionsFor("promotion", { reviewReason: "low_confidence", settings }))).toEqual([
      `label:${LABEL_REVIEW}`,
    ]);
  });

  it("only ever removes actions, never adds one", () => {
    const withAllowlist = PolicySettingsSchema.parse({ allowlist: ["shop.example"] });

    for (const category of CATEGORIES) {
      const plain = actionsFor(category);
      const overridden = actionsFor(category, { settings: withAllowlist });

      expect(overridden.length, category).toBeLessThanOrEqual(plain.length);
      for (const action of overridden) {
        expect(plain, category).toContainEqual(action);
      }
    }
  });
});

describe("the settings", () => {
  it("labels without archiving when archiving is off, so nothing leaves the inbox", () => {
    const settings = PolicySettingsSchema.parse({ archiveCleaned: false });

    for (const category of CATEGORIES) {
      const planned = types(actionsFor(category, { settings }));

      expect(planned, category).not.toContain("archive");
    }

    expect(types(actionsFor("promotion", { settings }))).toEqual([`label:${LABEL_CLEANED}`]);
  });

  it("marks cleaned mail read only when asked", () => {
    expect(types(actionsFor("promotion"))).not.toContain("mark_read");
    expect(
      types(
        actionsFor("promotion", {
          settings: PolicySettingsSchema.parse({ markCleanedRead: true }),
        }),
      ),
    ).toContain("mark_read");
  });

  it("leaves important mail alone when starring is off", () => {
    const settings = PolicySettingsSchema.parse({ starImportant: false });

    expect(actionsFor("important", { settings })).toEqual([]);
  });

  it("defaults to the cautious settings when none are given", () => {
    expect(DEFAULT_POLICY_SETTINGS).toEqual({
      confidenceThreshold: 0.6,
      archiveCleaned: true,
      markCleanedRead: false,
      starImportant: true,
      allowlist: [],
    });
  });
});

describe("the decision it returns", () => {
  it("carries the classification, the ids, the version and the time it was made", () => {
    const decision = decide({ email: email(), outcome: outcome("promotion"), now: NOW });

    expect(decision).toMatchObject({
      emailId: email().id,
      accountId: email().accountId,
      policyVersion: POLICY_VERSION,
      decidedAt: NOW,
    });
    expect(decision.classification?.category).toBe("promotion");
  });

  it("keeps the review reason and the detail, so a bad answer is still recorded", () => {
    const decision = decide({
      email: email(),
      outcome: {
        emailId: email().id,
        hints: [],
        reviewReason: "invalid_model_output",
        reviewDetail: "The model answered with reasoning only.",
      },
      now: NOW,
    });

    expect(decision.classification).toBeUndefined();
    expect(decision.reviewReason).toBe("invalid_model_output");
    expect(decision.reviewDetail).toBe("The model answered with reasoning only.");
  });

  it("records a label the email already had, so undo knows not to remove it", () => {
    const [action] = actionsFor("promotion", {
      email: email({ providerLabels: ["INBOX", LABEL_CLEANED] }),
    });

    expect(action).toEqual({ type: "label", label: LABEL_CLEANED, hadLabel: true });
    expect(isNoOp(action ?? { type: "star", wasStarred: false })).toBe(true);
  });

  it("plans an archive for mail already out of the inbox, and the executor sees a no-op", () => {
    const planned = actionsFor("promotion", { email: email({ isInInbox: false }) });
    const archive = planned.find((action) => action.type === "archive");

    expect(archive).toEqual({ type: "archive", wasInInbox: false });
    expect(archive === undefined ? false : isNoOp(archive)).toBe(true);
  });
});

describe("explainDecision", () => {
  it("uses the classification's own reason", () => {
    const decision = decide({ email: email(), outcome: outcome("promotion"), now: NOW });

    expect(explainDecision(decision)).toBe("It reads like promotion.");
  });

  it("falls back to what cleamail said when there is no classification", () => {
    const decision = decide({
      email: email(),
      outcome: {
        emailId: email().id,
        hints: [],
        reviewReason: "invalid_model_output",
        reviewDetail: "The model answered with reasoning only.",
      },
      now: NOW,
    });

    expect(explainDecision(decision)).toBe("The model answered with reasoning only.");
  });

  it("says something useful even when nothing explained itself", () => {
    const decision = decide({ email: email(), outcome: outcome(undefined), now: NOW });

    expect(explainDecision(decision)).toContain("could not be used");
  });
});

describe("removesFromInbox", () => {
  it("is true when the plan archives", () => {
    const decision = decide({ email: email(), outcome: outcome("promotion"), now: NOW });

    expect(removesFromInbox(decision)).toBe(true);
  });

  it("is false for a label-only plan, and for every protected category", () => {
    const labelOnly = decide({
      email: email(),
      outcome: outcome("promotion"),
      settings: PolicySettingsSchema.parse({ archiveCleaned: false }),
      now: NOW,
    });

    expect(removesFromInbox(labelOnly)).toBe(false);

    for (const category of CATEGORIES.filter(isProtectedCategory)) {
      const decision = decide({ email: email(), outcome: outcome(category), now: NOW });

      expect(removesFromInbox(decision), category).toBe(false);
    }
  });
});
