import { describe, expect, it } from "vitest";
import { isProtectedCategory } from "./category.js";
import { ClassificationSchema, ModelClassificationSchema } from "./classification.js";

const valid = {
  category: "newsletter",
  importance: 0.2,
  confidence: 0.91,
  reason: "Weekly digest with an unsubscribe link.",
  source: "model",
  model: "qwen2.5:7b",
};

describe("ClassificationSchema", () => {
  it("accepts a well-formed classification", () => {
    expect(ClassificationSchema.parse(valid).category).toBe("newsletter");
  });

  it("rejects an unknown category", () => {
    expect(ClassificationSchema.safeParse({ ...valid, category: "spam" }).success).toBe(false);
  });

  it("rejects scores outside 0..1", () => {
    expect(ClassificationSchema.safeParse({ ...valid, importance: 1.2 }).success).toBe(false);
    expect(ClassificationSchema.safeParse({ ...valid, confidence: -0.1 }).success).toBe(false);
  });

  it("requires a reason the user can read", () => {
    expect(ClassificationSchema.safeParse({ ...valid, reason: "   " }).success).toBe(false);
    expect(ClassificationSchema.safeParse({ ...valid, reason: "x".repeat(241) }).success).toBe(
      false,
    );
  });

  it("trims the reason", () => {
    expect(ClassificationSchema.parse({ ...valid, reason: "  Digest.  " }).reason).toBe("Digest.");
  });

  it("rejects an unknown source", () => {
    expect(ClassificationSchema.safeParse({ ...valid, source: "user" }).success).toBe(false);
  });
});

describe("ModelClassificationSchema", () => {
  it("drops fields the model is not allowed to claim", () => {
    const parsed = ModelClassificationSchema.parse({
      ...valid,
      source: "rule",
      ruleId: "pretend-rule",
    });

    expect(parsed).toStrictEqual({
      category: "newsletter",
      importance: 0.2,
      confidence: 0.91,
      reason: "Weekly digest with an unsubscribe link.",
    });
  });
});

describe("categories", () => {
  it("protects the categories that must stay in the inbox", () => {
    expect(isProtectedCategory("important")).toBe(true);
    expect(isProtectedCategory("needs_reply")).toBe(true);
    expect(isProtectedCategory("suspicious")).toBe(true);
    expect(isProtectedCategory("promotion")).toBe(false);
  });
});
