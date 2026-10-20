import { emailId, type ClassifiableEmail } from "@cleamail/core";

/** Synthetic only. CLAUDE.md forbids real email data in the repo, fixtures included. */
export function email(overrides: Partial<ClassifiableEmail> = {}): ClassifiableEmail {
  return {
    id: emailId("msg-1"),
    from: { address: "news@shop.example", name: "Shop" },
    to: [{ address: "user@example.com" }],
    subject: "Spring sale",
    snippet: "Everything must go",
    bodyText: "Our spring sale starts today.",
    headers: {},
    providerLabels: ["INBOX"],
    ...overrides,
  };
}
