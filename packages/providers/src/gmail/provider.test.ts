import { LABEL_CLEANED, type Email, type EmailId } from "@cleamail/core";
import { describe, expect, it } from "vitest";
import { describeMailProviderContract } from "../testing/mail-provider-contract.js";
import { StubGmailApi } from "../testing/stub-gmail-api.js";
import { GmailProvider } from "./provider.js";
import { buildFetchQuery } from "./query.js";
import { codeForStatus, isRetryable } from "./errors.js";
import type { GmailApi, GmailLabel, GmailListResponse, GmailMessage } from "./types.js";

describeMailProviderContract("GmailProvider", (emails) => {
  const api = new StubGmailApi("user@example.com", emails);

  return {
    provider: new GmailProvider(api),
    isTrashed: (id) => Promise.resolve(api.isTrashed(id)),
  };
});

function anEmail(overrides: Partial<Email> = {}): Email {
  return {
    id: "msg-1" as Email["id"],
    threadId: "thread-1" as Email["threadId"],
    accountId: "user@example.com" as Email["accountId"],
    from: { address: "news@shop.example" },
    to: [],
    cc: [],
    subject: "Digest",
    snippet: "",
    bodyText: "Body.",
    headers: {},
    providerLabels: ["INBOX"],
    isRead: false,
    isStarred: false,
    isInInbox: true,
    receivedAt: new Date("2026-10-05T10:00:00.000Z"),
    sizeBytes: 100,
    ...overrides,
  };
}

describe("GmailProvider", () => {
  it("resolves the label name it was asked for, not an opaque id", async () => {
    const api = new StubGmailApi("user@example.com", [anEmail()]);
    const provider = new GmailProvider(api);

    await provider.applyActions("msg-1" as EmailId, [
      { type: "label", label: LABEL_CLEANED, hadLabel: false },
    ]);

    const read = await provider.getEmail("msg-1" as EmailId);

    expect(read.ok && read.value.providerLabels).toContain(LABEL_CLEANED);
  });

  it("trims the window precisely, because Gmail's after: is day-granular", async () => {
    const api = new StubGmailApi("user@example.com", [
      anEmail({ id: "recent" as Email["id"], receivedAt: new Date("2026-10-05T10:00:00.000Z") }),
      anEmail({
        id: "just-too-old" as Email["id"],
        receivedAt: new Date("2026-10-04T22:00:00.000Z"),
      }),
    ]);

    const page = await new GmailProvider(api).listEmails({
      since: new Date("2026-10-05T00:00:00.000Z"),
    });

    expect(page.ok && page.value.emails.map((email) => email.id)).toStrictEqual(["recent"]);
  });

  it("skips a message it cannot map instead of failing the whole run", async () => {
    const broken: GmailMessage = {
      id: "broken",
      threadId: "t",
      labelIds: ["INBOX"],
      snippet: "",
      payload: { mimeType: "text/plain", filename: "", headers: [] },
    };

    const api: GmailApi = {
      getProfile: () => Promise.resolve({ emailAddress: "user@example.com" }),
      listMessages: (): Promise<GmailListResponse> =>
        Promise.resolve({ messages: [{ id: "broken" }, { id: "good" }] }),
      getMessage: (id) =>
        id === "broken"
          ? Promise.resolve(broken)
          : Promise.resolve({
              ...broken,
              id: "good",
              internalDate: "1791187200000",
              payload: {
                mimeType: "text/plain",
                filename: "",
                headers: [{ name: "From", value: "a@b.c" }],
                body: { data: Buffer.from("hi", "utf8").toString("base64url") },
              },
            }),
      modifyMessage: () => Promise.resolve(),
      trashMessage: () => Promise.resolve(),
      untrashMessage: () => Promise.resolve(),
      listLabels: (): Promise<GmailLabel[]> => Promise.resolve([{ id: "INBOX", name: "INBOX" }]),
      createLabel: (name) => Promise.resolve({ id: `Label_${name}`, name }),
    };

    const page = await new GmailProvider(api).listEmails({
      since: new Date("2026-10-01T00:00:00.000Z"),
    });

    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.emails.map((email) => email.id)).toStrictEqual(["good"]);
  });

  it("reports an expired authorization as provider_auth so the caller can ask for a reconnect", async () => {
    const api = new StubGmailApi("user@example.com", []);
    const failing: GmailApi = {
      ...api,
      getProfile: () => Promise.reject(Object.assign(new Error("invalid_grant"), { status: 401 })),
      listMessages: api.listMessages.bind(api),
      getMessage: api.getMessage.bind(api),
      modifyMessage: api.modifyMessage.bind(api),
      trashMessage: api.trashMessage.bind(api),
      untrashMessage: api.untrashMessage.bind(api),
      listLabels: api.listLabels.bind(api),
      createLabel: api.createLabel.bind(api),
    };

    const account = await new GmailProvider(failing).account();

    expect(account.ok).toBe(false);
    if (account.ok) return;
    expect(account.error.code).toBe("provider_auth");
  });

  it("asks Gmail for labels once and caches them", async () => {
    const api = new StubGmailApi("user@example.com", [anEmail()]);
    const provider = new GmailProvider(api);

    await provider.listEmails({ since: new Date("2026-10-01T00:00:00.000Z") });
    await provider.getEmail("msg-1" as EmailId);
    await provider.ensureLabels([LABEL_CLEANED]);

    expect(api.calls.listLabels).toBe(1);
  });

  it("collapses actions into a single modify call", async () => {
    const api = new StubGmailApi("user@example.com", [anEmail()]);
    const provider = new GmailProvider(api);

    await provider.applyActions("msg-1" as EmailId, [
      { type: "label", label: LABEL_CLEANED, hadLabel: false },
      { type: "archive", wasInInbox: true },
      { type: "mark_read", wasRead: false },
    ]);

    expect(api.calls.modifyMessage).toBe(1);
  });
});

describe("buildFetchQuery", () => {
  it("asks for one day more than requested and skips chats", () => {
    expect(buildFetchQuery(new Date("2026-10-05T10:00:00.000Z"))).toBe(
      "after:2026/10/04 -in:chats",
    );
  });

  it("crosses a month boundary correctly", () => {
    expect(buildFetchQuery(new Date("2026-11-01T00:30:00.000Z"))).toContain("after:2026/10/31");
  });
});

describe("error mapping", () => {
  it("maps HTTP status to the code the caller acts on", () => {
    expect(codeForStatus(401)).toBe("provider_auth");
    expect(codeForStatus(403)).toBe("provider_auth");
    expect(codeForStatus(404)).toBe("not_found");
    expect(codeForStatus(429)).toBe("provider_rate_limited");
    expect(codeForStatus(503)).toBe("provider_unavailable");
    expect(codeForStatus(undefined)).toBe("provider_unavailable");
  });

  it("knows what is worth retrying", () => {
    expect(isRetryable({ status: 429 })).toBe(true);
    expect(isRetryable({ status: 500 })).toBe(true);
    expect(isRetryable({ status: 401 })).toBe(false);
    expect(isRetryable(new Error("offline"))).toBe(false);
  });
});
