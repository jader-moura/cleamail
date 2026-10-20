import { describe, expect, it } from "vitest";
import { addressDomain, EmailSchema, formatAddress } from "./email.js";

const minimal = {
  id: "m-1",
  threadId: "t-1",
  accountId: "a-1",
  from: { address: "news@shop.example", name: "Shop" },
  isRead: false,
  isStarred: false,
  isInInbox: true,
  receivedAt: "2026-10-01T10:00:00.000Z",
};

describe("EmailSchema", () => {
  it("fills defaults so adapters only map what they have", () => {
    const parsed = EmailSchema.parse(minimal);

    expect(parsed.subject).toBe("");
    expect(parsed.bodyText).toBe("");
    expect(parsed.to).toStrictEqual([]);
    expect(parsed.cc).toStrictEqual([]);
    expect(parsed.headers).toStrictEqual({});
    expect(parsed.providerLabels).toStrictEqual([]);
    expect(parsed.sizeBytes).toBe(0);
    expect(parsed.receivedAt).toBeInstanceOf(Date);
  });

  it("rejects a message without an id", () => {
    expect(EmailSchema.safeParse({ ...minimal, id: "" }).success).toBe(false);
  });

  it("rejects a negative size", () => {
    expect(EmailSchema.safeParse({ ...minimal, sizeBytes: -1 }).success).toBe(false);
  });
});

describe("address helpers", () => {
  it("formats with and without a display name", () => {
    expect(formatAddress({ address: "a@b.c", name: "A B" })).toBe("A B <a@b.c>");
    expect(formatAddress({ address: "a@b.c" })).toBe("a@b.c");
    expect(formatAddress({ address: "a@b.c", name: "" })).toBe("a@b.c");
  });

  it("extracts a lowercase domain", () => {
    expect(addressDomain({ address: "News@Shop.Example" })).toBe("shop.example");
  });

  it("returns undefined for an address with no usable domain", () => {
    expect(addressDomain({ address: "broken" })).toBeUndefined();
    expect(addressDomain({ address: "broken@" })).toBeUndefined();
  });
});
