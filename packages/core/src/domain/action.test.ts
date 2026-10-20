import { describe, expect, it } from "vitest";
import { ActionSchema, isNoOp, isRemoving } from "./action.js";
import { isReservedLabel, LABEL_CLEANED, LABEL_REVIEW } from "./labels.js";

describe("ActionSchema", () => {
  it("parses each action type with its reversal data", () => {
    expect(
      ActionSchema.parse({ type: "label", label: LABEL_CLEANED, hadLabel: false }),
    ).toStrictEqual({ type: "label", label: LABEL_CLEANED, hadLabel: false });
    expect(ActionSchema.parse({ type: "trash", wasInInbox: false }).type).toBe("trash");
  });

  it("defaults previousLabels on trash, since undo needs a list either way", () => {
    const parsed = ActionSchema.parse({ type: "trash", wasInInbox: true });

    expect(parsed).toStrictEqual({ type: "trash", wasInInbox: true, previousLabels: [] });
  });

  it("rejects an action type outside the closed set", () => {
    expect(ActionSchema.safeParse({ type: "delete" }).success).toBe(false);
  });

  it("rejects an action missing its reversal data", () => {
    expect(ActionSchema.safeParse({ type: "archive" }).success).toBe(false);
    expect(ActionSchema.safeParse({ type: "label", label: LABEL_REVIEW }).success).toBe(false);
  });
});

describe("isNoOp", () => {
  it("detects actions that would change nothing", () => {
    expect(isNoOp({ type: "label", label: LABEL_CLEANED, hadLabel: true })).toBe(true);
    expect(isNoOp({ type: "star", wasStarred: true })).toBe(true);
    expect(isNoOp({ type: "archive", wasInInbox: false })).toBe(true);
    expect(isNoOp({ type: "mark_read", wasRead: true })).toBe(true);
  });

  it("treats a trash move as always meaningful", () => {
    expect(isNoOp({ type: "trash", wasInInbox: false, previousLabels: [] })).toBe(false);
  });

  it("detects actions that do change something", () => {
    expect(isNoOp({ type: "label", label: LABEL_CLEANED, hadLabel: false })).toBe(false);
    expect(isNoOp({ type: "archive", wasInInbox: true })).toBe(false);
  });
});

describe("isRemoving", () => {
  it("flags the actions that take a message out of the inbox", () => {
    expect(isRemoving({ type: "archive", wasInInbox: true })).toBe(true);
    expect(isRemoving({ type: "trash", wasInInbox: true, previousLabels: [] })).toBe(true);
    expect(isRemoving({ type: "star", wasStarred: false })).toBe(false);
  });
});

describe("labels", () => {
  it("knows the labels cleamail owns", () => {
    expect(isReservedLabel(LABEL_CLEANED)).toBe(true);
    expect(isReservedLabel("Inbox")).toBe(false);
  });
});
