import { emailId } from "@cleamail/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ACCOUNT,
  LOCAL_HEADERS,
  anEmail,
  createServerHarness,
  type ServerHarness,
} from "./test/harness.js";

describe("the local API", () => {
  let harness: ServerHarness;

  afterEach(async () => {
    await harness.close();
  });

  describe("GET /api/health", () => {
    beforeEach(async () => {
      harness = await createServerHarness({ connected: false });
    });

    it("answers before a mailbox is connected", async () => {
      const response = await harness.app.inject({
        method: "GET",
        url: "/api/health",
        headers: LOCAL_HEADERS,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toStrictEqual({ status: "ok", version: "0.1.0-test" });
    });

    it("sends no CORS header, so no page the user visits can read it", async () => {
      const response = await harness.app.inject({
        method: "GET",
        url: "/api/health",
        headers: { ...LOCAL_HEADERS, origin: "https://not-your-mailbox.example" },
      });

      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });

  describe("GET /api/status", () => {
    it("reports the mailbox, the counts and whether it may be changed", async () => {
      harness = await createServerHarness({ emails: [anEmail()] });

      const response = await harness.app.inject({
        method: "GET",
        url: "/api/status",
        headers: LOCAL_HEADERS,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        model: "qwen2.5:7b",
        mailbox: { address: ACCOUNT.address, kind: "gmail", canModify: true, messages: 1 },
      });
    });

    it("says a read-only mailbox cannot be changed, so no button lies", async () => {
      harness = await createServerHarness({ emails: [anEmail()], canModify: false });

      const response = await harness.app.inject({
        method: "GET",
        url: "/api/status",
        headers: LOCAL_HEADERS,
      });

      expect(response.json()).toMatchObject({ mailbox: { canModify: false } });
    });

    it("answers without a mailbox rather than failing", async () => {
      harness = await createServerHarness({ connected: false });

      const response = await harness.app.inject({
        method: "GET",
        url: "/api/status",
        headers: LOCAL_HEADERS,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).not.toHaveProperty("mailbox");
    });
  });

  describe("GET /api/decisions", () => {
    beforeEach(async () => {
      harness = await createServerHarness({
        emails: [anEmail(), anEmail({ id: emailId("msg-2") })],
      });
    });

    it("returns what was applied, newest first, with the actions", async () => {
      await harness.applyRun("run-1", [anEmail(), anEmail({ id: emailId("msg-2") })]);

      const response = await harness.app.inject({
        method: "GET",
        url: "/api/decisions",
        headers: LOCAL_HEADERS,
      });

      expect(response.statusCode).toBe(200);

      const body = response.json<{ decisions: { emailId: string; actions: unknown[] }[] }>();

      expect(body.decisions).toHaveLength(2);
      expect(body.decisions[0]?.emailId).toBe("msg-2");
      expect(body.decisions[0]?.actions).toHaveLength(2);
    });

    it("says which actions an undo would send", async () => {
      await harness.applyRun("run-1", [anEmail()]);

      const response = await harness.app.inject({
        method: "GET",
        url: "/api/decisions?emailId=msg-1",
        headers: LOCAL_HEADERS,
      });

      const body = response.json<{
        decisions: { actions: { type: string; outcome: string; reversible: boolean }[] }[];
      }>();

      expect(body.decisions[0]?.actions.every((action) => action.reversible)).toBe(true);
      expect(body.decisions[0]?.actions.map((action) => action.type).sort()).toStrictEqual([
        "archive",
        "label",
      ]);
    });

    it("carries the explanation, and no subject, sender or body", async () => {
      await harness.applyRun("run-1", [anEmail({ subject: "Half price everything" })]);

      const response = await harness.app.inject({
        method: "GET",
        url: "/api/decisions",
        headers: LOCAL_HEADERS,
      });

      expect(response.body).toContain("It offers a discount.");
      expect(response.body).not.toContain("Half price everything");
      expect(response.body).not.toContain("news@shop.example");
      expect(response.body).not.toContain("Body.");
    });

    it("carries a decision the model could not classify, in cleamail's own words", async () => {
      await harness.applyRun("run-1", [anEmail()], { unclassified: true });

      const response = await harness.app.inject({
        method: "GET",
        url: "/api/decisions",
        headers: LOCAL_HEADERS,
      });

      const body = response.json<{
        decisions: {
          category?: string;
          confidence?: number;
          reviewReason?: string;
          explanation: string;
          actions: { type: string }[];
        }[];
      }>();
      const decision = body.decisions[0];

      expect(decision?.category).toBeUndefined();
      expect(decision?.confidence).toBeUndefined();
      expect(decision?.reviewReason).toBe("invalid_model_output");
      expect(decision?.explanation).toContain("answered with reasoning");
      expect(decision?.actions.map((action) => action.type)).toStrictEqual(["label"]);
    });

    it("refuses a limit it cannot use, naming the field", async () => {
      const response = await harness.app.inject({
        method: "GET",
        url: "/api/decisions?limit=nine",
        headers: LOCAL_HEADERS,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: { code: string; message: string } }>().error).toMatchObject({
        code: "bad_request",
      });
      expect(response.body).toContain("limit");
    });

    it("tells an unconnected user what to do, as a status the dashboard can act on", async () => {
      await harness.close();
      harness = await createServerHarness({ connected: false });

      const response = await harness.app.inject({
        method: "GET",
        url: "/api/decisions",
        headers: LOCAL_HEADERS,
      });

      expect(response.statusCode).toBe(409);
      expect(response.json<{ error: { code: string } }>().error.code).toBe("config_invalid");
      expect(response.body).toContain("cleamail init");
    });
  });

  describe("GET /api/audit", () => {
    it("returns the log, newest first", async () => {
      harness = await createServerHarness({ emails: [anEmail()] });
      await harness.applyRun("run-1", [anEmail()]);

      const response = await harness.app.inject({
        method: "GET",
        url: "/api/audit?limit=5",
        headers: LOCAL_HEADERS,
      });

      const body = response.json<{ audit: { kind: string; summary: string }[] }>();

      expect(response.statusCode).toBe(200);
      expect(body.audit[0]?.kind).toBe("apply");
      expect(body.audit[0]?.summary).toContain("Applied");
    });

    it("answers with an empty log rather than nothing at all", async () => {
      harness = await createServerHarness();

      const response = await harness.app.inject({
        method: "GET",
        url: "/api/audit",
        headers: LOCAL_HEADERS,
      });

      expect(response.json()).toStrictEqual({ audit: [] });
    });
  });

  describe("POST /api/undo", () => {
    beforeEach(async () => {
      harness = await createServerHarness({ emails: [anEmail()] });
    });

    it("reverses the last run through the same executor the CLI uses", async () => {
      await harness.applyRun("run-1", [anEmail()]);

      const response = await harness.app.inject({
        method: "POST",
        url: "/api/undo",
        headers: LOCAL_HEADERS,
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        runId: "run-1",
        emailsRestored: 1,
        reversed: 2,
      });

      const read = await harness.provider.getEmail(emailId("msg-1"));

      expect(read.ok && read.value.isInInbox).toBe(true);
    });

    it("reverses one email when asked for one", async () => {
      // Both emails have to be in the store: a decision row references the email it is about, so
      // the schema itself refuses a decision about mail cleamail never fetched.
      await harness.close();
      harness = await createServerHarness({
        emails: [anEmail(), anEmail({ id: emailId("msg-2") })],
      });

      await harness.applyRun("run-1", [anEmail(), anEmail({ id: emailId("msg-2") })]);

      const response = await harness.app.inject({
        method: "POST",
        url: "/api/undo",
        headers: LOCAL_HEADERS,
        payload: { emailId: "msg-2" },
      });

      expect(response.json()).toMatchObject({ emailsRestored: 1 });

      const first = await harness.provider.getEmail(emailId("msg-1"));
      const second = await harness.provider.getEmail(emailId("msg-2"));

      expect(first.ok && first.value.isInInbox).toBe(false);
      expect(second.ok && second.value.isInInbox).toBe(true);
    });

    it("reports a second undo as nothing left to do", async () => {
      await harness.applyRun("run-1", [anEmail()]);
      await harness.app.inject({
        method: "POST",
        url: "/api/undo",
        headers: LOCAL_HEADERS,
        payload: {},
      });

      const response = await harness.app.inject({
        method: "POST",
        url: "/api/undo",
        headers: LOCAL_HEADERS,
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ reversed: 0, alreadyReversed: 2 });
    });

    it("shows an undone run as undone, so the button does not offer it twice", async () => {
      await harness.applyRun("run-1", [anEmail()]);
      await harness.app.inject({
        method: "POST",
        url: "/api/undo",
        headers: LOCAL_HEADERS,
        payload: {},
      });

      const response = await harness.app.inject({
        method: "GET",
        url: "/api/decisions",
        headers: LOCAL_HEADERS,
      });

      const body = response.json<{
        decisions: {
          actions: { outcome: string; reversible: boolean; reversedAt?: string }[];
        }[];
      }>();
      const actions = body.decisions[0]?.actions ?? [];

      expect(actions.every((action) => action.outcome === "reversed")).toBe(true);
      expect(actions.every((action) => action.reversible === false)).toBe(true);
      expect(actions[0]?.reversedAt).toBe("2026-10-22T09:00:00.000Z");
    });

    it("says there is nothing to undo, with a code the dashboard can read", async () => {
      const response = await harness.app.inject({
        method: "POST",
        url: "/api/undo",
        headers: LOCAL_HEADERS,
        payload: {},
      });

      expect(response.statusCode).toBe(404);
      expect(response.json<{ error: { code: string } }>().error.code).toBe("not_found");
    });

    it("refuses a read-only mailbox with a code of its own", async () => {
      await harness.applyRun("run-1", [anEmail()]);
      await harness.close();

      harness = await createServerHarness({ emails: [anEmail()], canModify: false });

      const response = await harness.app.inject({
        method: "POST",
        url: "/api/undo",
        headers: LOCAL_HEADERS,
        payload: { runId: "run-1" },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json<{ error: { code: string } }>().error.code).toBe("unsupported_operation");
    });

    it("refuses a body it cannot read", async () => {
      const response = await harness.app.inject({
        method: "POST",
        url: "/api/undo",
        headers: LOCAL_HEADERS,
        payload: { runId: 7 },
      });

      expect(response.statusCode).toBe(400);
      expect(response.body).toContain("runId");
    });
  });

  describe("anything else", () => {
    beforeEach(async () => {
      harness = await createServerHarness();
    });

    it("answers an unknown route in the same shape as every other error", async () => {
      const response = await harness.app.inject({
        method: "GET",
        url: "/api/everything",
        headers: LOCAL_HEADERS,
      });

      expect(response.statusCode).toBe(404);
      expect(response.json<{ error: { code: string } }>().error.code).toBe("not_found");
    });

    it("does not answer a write to a route that only reads", async () => {
      const response = await harness.app.inject({
        method: "POST",
        url: "/api/decisions",
        headers: LOCAL_HEADERS,
        payload: {},
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
