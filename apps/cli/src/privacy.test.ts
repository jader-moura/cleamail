import { installNetworkGuard, type NetworkGuard } from "@cleamail/privacy";
import { emailId, ok } from "@cleamail/core";
import { FakeClassifier } from "@cleamail/llm/testing";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "./cli.js";
import { EXIT } from "./exit.js";
import { ACCOUNT, anEmail, createHarness } from "./test/harness.js";

/**
 * The CLI's own privacy check.
 *
 * A fetch and a store should involve the mail provider and nothing else, so with the provider
 * faked, a whole run should make no outbound call at all. If an update check, a crash reporter or
 * an analytics ping ever appears in this app, this test is what notices.
 */
describe("the CLI under the privacy guard", () => {
  let guard: NetworkGuard | undefined;

  afterEach(() => {
    guard?.restore();
    guard = undefined;
  });

  it("makes no outbound call while fetching and storing mail", async () => {
    const harness = await createHarness({
      emails: [anEmail(), anEmail({ id: emailId("msg-2") })],
    });

    guard = installNetworkGuard();

    try {
      expect(await runCli(["run", "--since", "7d"], harness.deps)).toBe(EXIT.ok);

      expect(guard.attempts).toStrictEqual([]);
    } finally {
      harness.close();
    }
  });

  it("makes no outbound call while applying or undoing", async () => {
    const harness = await createHarness({
      emails: [anEmail()],
      classifier: ok(new FakeClassifier({ category: "promotion", confidence: 0.95 })),
    });

    guard = installNetworkGuard();

    try {
      expect(await runCli(["run", "--apply"], harness.deps)).toBe(EXIT.ok);
      expect(await runCli(["undo", "--last"], harness.deps)).toBe(EXIT.ok);

      expect(guard.attempts).toStrictEqual([]);
    } finally {
      harness.close();
    }
  });

  it("makes no outbound call while reporting status", async () => {
    const harness = await createHarness({ emails: [anEmail()] });

    guard = installNetworkGuard();

    try {
      expect(await runCli(["status"], harness.deps)).toBe(EXIT.ok);

      expect(guard.violations).toStrictEqual([]);
    } finally {
      harness.close();
    }
  });
});

/**
 * The audit log is the table a user is most likely to copy into a bug report, so it may hold ids,
 * counts, categories and reasons, and nothing that came out of an email.
 */
describe("what applying writes down", () => {
  const SUBJECT = "Your mortgage statement for October";
  const SENDER = "statements@bank.example";
  const BODY = "Your payment of 1,240.00 was received.";

  it("keeps the subject, the sender and the body out of the audit log", async () => {
    const harness = await createHarness({
      emails: [
        anEmail({
          subject: SUBJECT,
          from: { address: SENDER, name: "The Bank" },
          bodyText: BODY,
          snippet: BODY.slice(0, 20),
        }),
      ],
      classifier: ok(new FakeClassifier({ category: "promotion", confidence: 0.95 })),
    });

    try {
      await runCli(["run", "--apply"], harness.deps);
      await runCli(["undo", "--last"], harness.deps);

      const audit = await harness.store.audit.list();
      const written = audit.ok ? JSON.stringify(audit.value) : "";

      expect(written).not.toContain(SUBJECT);
      expect(written).not.toContain(SENDER);
      expect(written).not.toContain("1,240.00");
      // It does say what happened, in ids and counts.
      expect(written).toContain("Applied");
      expect(written).toContain("Undid");
    } finally {
      harness.close();
    }
  });

  it("keeps the mail itself out of the stored actions as well", async () => {
    const harness = await createHarness({
      emails: [anEmail({ subject: SUBJECT, from: { address: SENDER }, bodyText: BODY })],
      classifier: ok(new FakeClassifier({ category: "promotion", confidence: 0.95 })),
    });

    try {
      await runCli(["run", "--apply"], harness.deps);

      const stored = await harness.store.decisions.listDecisions({ accountId: ACCOUNT.id });
      const actions = stored.ok ? JSON.stringify(stored.value.flatMap((row) => row.actions)) : "";

      // The decision row keeps the model's reason, which is shown to the user. An action row holds
      // only the change and the state it found, so it is the one thing that can be logged freely.
      expect(actions).not.toContain(SUBJECT);
      expect(actions).not.toContain(BODY);
    } finally {
      harness.close();
    }
  });
});
