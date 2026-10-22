import { describe, expect, it } from "vitest";
import { actionLabel, categoryLabel, plural, reviewLabel, senderLabel, timeAgo } from "./format.js";
import { group } from "./queries.js";
import { aDecision } from "./test/render.js";

const NOW = new Date("2026-10-22T12:00:00.000Z");

describe("categoryLabel", () => {
  it("names every category the domain has", () => {
    expect(categoryLabel("needs_reply")).toBe("Needs reply");
    expect(categoryLabel("fyi")).toBe("FYI");
  });

  it("says unreadable when the model gave nothing", () => {
    expect(categoryLabel(undefined)).toBe("Unreadable");
  });

  it("falls back to the value rather than showing nothing", () => {
    expect(categoryLabel("something_new")).toBe("something_new");
  });
});

describe("reviewLabel", () => {
  it("explains each review reason in words a person uses", () => {
    expect(reviewLabel("low_confidence")).toBe("cleamail was not sure");
    expect(reviewLabel("suspicious")).toBe("it looks like a forgery");
    expect(reviewLabel(undefined)).toBe("needs a look");
  });
});

describe("senderLabel", () => {
  it("prefers the name, and copes without one", () => {
    expect(senderLabel({ from: "a@b.example", fromName: "Sam" })).toBe("Sam <a@b.example>");
    expect(senderLabel({ from: "a@b.example" })).toBe("a@b.example");
    expect(senderLabel({ from: "a@b.example", fromName: "  " })).toBe("a@b.example");
  });

  it("says so when the mail is gone rather than rendering nothing", () => {
    expect(senderLabel(undefined)).toBe("unknown sender");
  });
});

describe("timeAgo", () => {
  it("reads as a person would say it", () => {
    expect(timeAgo("2026-10-22T11:59:30.000Z", NOW)).toBe("just now");
    expect(timeAgo("2026-10-22T11:30:00.000Z", NOW)).toBe("30m ago");
    expect(timeAgo("2026-10-22T06:00:00.000Z", NOW)).toBe("6h ago");
    expect(timeAgo("2026-10-21T06:00:00.000Z", NOW)).toBe("yesterday");
    expect(timeAgo("2026-10-18T06:00:00.000Z", NOW)).toBe("4d ago");
  });

  it("does not print an invalid date as NaN", () => {
    expect(timeAgo("not a date", NOW)).toBe("at an unknown time");
  });
});

describe("plural", () => {
  it("agrees with its count", () => {
    expect(plural(1, "email", "emails")).toBe("1 email");
    expect(plural(0, "email", "emails")).toBe("0 emails");
  });
});

describe("actionLabel", () => {
  it("says what each action does, in the user's words", () => {
    expect(actionLabel("archive")).toBe("archive it");
    expect(actionLabel("mark_read")).toBe("mark it read");
    expect(actionLabel("trash")).toBe("move it to Trash");
  });
});

describe("group", () => {
  it("puts the newest dry run forward as the one waiting for an answer", () => {
    const grouped = group([
      aDecision({ id: 3, runId: "preview-2", dryRun: true }),
      aDecision({ id: 2, runId: "preview-1", dryRun: true }),
      aDecision({ id: 1, runId: "run-1", dryRun: false }),
    ]);

    expect(grouped.preview?.runId).toBe("preview-2");
    expect(grouped.preview?.decisions).toHaveLength(1);
  });

  it("has no preview when everything has been applied", () => {
    expect(group([aDecision()]).preview).toBeUndefined();
  });

  it("counts an email as cleaned only when something removed it from the inbox", () => {
    const labelled = aDecision({
      id: 2,
      actions: [
        {
          id: 9,
          type: "label",
          outcome: "applied",
          at: NOW.toISOString(),
          reversible: true,
        },
      ],
    });

    const grouped = group([aDecision(), labelled]);

    expect(grouped.cleaned.map((decision) => decision.id)).toStrictEqual([1]);
  });

  it("keeps what needs attention out of what was cleaned", () => {
    const important = aDecision({
      id: 4,
      category: "important",
      actions: [
        { id: 8, type: "star", outcome: "applied", at: NOW.toISOString(), reversible: true },
      ],
    });

    const grouped = group([important, aDecision()]);

    expect(grouped.needsAttention.map((decision) => decision.id)).toStrictEqual([4]);
    expect(grouped.cleaned.map((decision) => decision.id)).toStrictEqual([1]);
  });

  it("sends anything with a review reason to its own list", () => {
    const unsure = aDecision({ id: 5, reviewReason: "low_confidence", category: "promotion" });

    const grouped = group([unsure]);

    expect(grouped.review).toHaveLength(1);
    expect(grouped.needsAttention).toHaveLength(0);
  });
});
