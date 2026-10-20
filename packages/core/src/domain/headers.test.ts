import { describe, expect, it } from "vitest";
import { getHeader, hasHeader, normalizeHeaders } from "./headers.js";

describe("normalizeHeaders", () => {
  it("lowercases names and trims values", () => {
    const headers = normalizeHeaders([{ name: "List-Unsubscribe", value: "  <mailto:x@y.z>  " }]);

    expect(headers).toStrictEqual({ "list-unsubscribe": "<mailto:x@y.z>" });
  });

  it("joins repeated headers instead of losing one", () => {
    const headers = normalizeHeaders([
      { name: "Received", value: "from a" },
      { name: "received", value: "from b" },
    ]);

    expect(headers["received"]).toBe("from a, from b");
  });

  it("skips headers with an empty name", () => {
    expect(normalizeHeaders([{ name: "   ", value: "v" }])).toStrictEqual({});
  });

  it("looks headers up case-insensitively", () => {
    const headers = normalizeHeaders([{ name: "X-Mailer", value: "cleamail" }]);

    expect(getHeader(headers, "X-MAILER")).toBe("cleamail");
    expect(hasHeader(headers, "x-mailer")).toBe(true);
    expect(getHeader(headers, "x-missing")).toBeUndefined();
    expect(hasHeader(headers, "x-missing")).toBe(false);
  });
});
