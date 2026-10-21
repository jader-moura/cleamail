import { describe, expect, it } from "vitest";
import {
  accessOfScopes,
  canModify,
  FORBIDDEN_SCOPES,
  GMAIL_READONLY_SCOPES,
  GMAIL_SCOPES,
  scopeString,
  scopesFor,
} from "./scopes.js";

/**
 * Scopes are the one place where a mistake hands someone else's mail to a bug, so the rules are
 * pinned down here rather than left to the call sites.
 */
describe("the scopes cleamail asks for", () => {
  it("asks for exactly one scope in each mode", () => {
    expect(GMAIL_SCOPES).toHaveLength(1);
    expect(GMAIL_READONLY_SCOPES).toHaveLength(1);
  });

  it("never asks to send, compose or permanently delete", () => {
    for (const scope of [...GMAIL_SCOPES, ...GMAIL_READONLY_SCOPES]) {
      expect(FORBIDDEN_SCOPES).not.toContain(scope);
    }

    expect(FORBIDDEN_SCOPES).toContain("https://www.googleapis.com/auth/gmail.send");
    // Permanent deletion needs this one, and cleamail goes no further than Trash.
    expect(FORBIDDEN_SCOPES).toContain("https://mail.google.com/");
  });

  it("defaults to modify, so nothing silently loses the ability to act", () => {
    expect(scopeString()).toBe("https://www.googleapis.com/auth/gmail.modify");
  });

  it("asks for readonly when that is what was requested", () => {
    expect(scopeString("readonly")).toBe("https://www.googleapis.com/auth/gmail.readonly");
    expect(scopesFor("readonly")).toStrictEqual(GMAIL_READONLY_SCOPES);
  });
});

describe("reading access back off a token", () => {
  it("recognises a modify token", () => {
    expect(accessOfScopes([...GMAIL_SCOPES])).toBe("modify");
    expect(canModify([...GMAIL_SCOPES])).toBe(true);
  });

  it("recognises a readonly token", () => {
    expect(accessOfScopes([...GMAIL_READONLY_SCOPES])).toBe("readonly");
    expect(canModify([...GMAIL_READONLY_SCOPES])).toBe(false);
  });

  it("treats anything it cannot interpret as unable to act", () => {
    // Being wrong in this direction means refusing to act, which is the safe way to be wrong.
    expect(canModify([])).toBe(false);
    expect(canModify(["https://www.googleapis.com/auth/userinfo.email"])).toBe(false);
    expect(canModify(["gmail.modify"])).toBe(false);
  });

  it("still sees modify when Google adds scopes of its own", () => {
    expect(
      canModify([...GMAIL_SCOPES, "openid", "https://www.googleapis.com/auth/userinfo.email"]),
    ).toBe(true);
  });
});
