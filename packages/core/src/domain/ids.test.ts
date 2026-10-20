import { describe, expect, it } from "vitest";
import { accountId, emailId, EmailIdSchema, threadId } from "./ids.js";

describe("branded ids", () => {
  it("keeps the underlying string", () => {
    expect(emailId("m-1")).toBe("m-1");
    expect(threadId("t-1")).toBe("t-1");
    expect(accountId("a-1")).toBe("a-1");
  });

  it("rejects an empty id", () => {
    expect(() => emailId("")).toThrow();
    expect(EmailIdSchema.safeParse("").success).toBe(false);
  });
});
