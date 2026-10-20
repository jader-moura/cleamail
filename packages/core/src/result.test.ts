import { describe, expect, it } from "vitest";
import { domainError, err, failure, isErr, isOk, mapResult, ok, unwrapOr } from "./result.js";

describe("result", () => {
  it("narrows ok and err", () => {
    const good = ok(1);
    const bad = err(domainError("not_found", "nope"));

    expect(isOk(good)).toBe(true);
    expect(isErr(bad)).toBe(true);

    if (isOk(good)) expect(good.value).toBe(1);
    if (isErr(bad)) expect(bad.error.code).toBe("not_found");
  });

  it("omits cause when none is given", () => {
    expect(domainError("store_failure", "boom")).toStrictEqual({
      code: "store_failure",
      message: "boom",
    });
  });

  it("keeps the cause when one is given", () => {
    const cause = new Error("disk full");
    expect(domainError("store_failure", "boom", cause).cause).toBe(cause);
  });

  it("maps only the ok branch", () => {
    expect(mapResult(ok(2), (n) => n * 2)).toStrictEqual(ok(4));

    const original = failure("provider_auth", "expired");
    expect(mapResult(original, (n: number) => n * 2)).toBe(original);
  });

  it("falls back on err", () => {
    expect(unwrapOr(ok("a"), "b")).toBe("a");
    expect(unwrapOr(failure("not_found", "missing"), "b")).toBe("b");
  });
});
