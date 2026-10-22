import { emailId, ok, type Email } from "@cleamail/core";
import { FakeClassifier } from "@cleamail/llm/testing";
import { describe, expect, it } from "vitest";
import { runCli } from "../cli.js";
import { EXIT } from "../exit.js";
import { ACCOUNT, anEmail, createHarness } from "../test/harness.js";

/**
 * A run whose mail is cleanable, so there is something to apply.
 *
 * The classifier is pinned to `promotion` rather than left on the fake's default `fyi`: the policy
 * engine plans nothing at all for `fyi`, which is correct and makes for a poor test of applying.
 */
function cleanableRun(emails: readonly Email[], options: { canModify?: boolean } = {}) {
  return createHarness({
    emails,
    classifier: ok(new FakeClassifier({ category: "promotion", confidence: 0.95 })),
    ...(options.canModify === undefined ? {} : { canModify: options.canModify }),
  });
}

/** The mailbox as the fake provider holds it, which is what a real one would look like. */
async function mailbox(
  harness: Awaited<ReturnType<typeof cleanableRun>>,
  id = "msg-1",
): Promise<{ inInbox: boolean; labels: readonly string[] }> {
  const read = await harness.provider.getEmail(emailId(id));
  if (!read.ok) throw new Error(`Expected to read ${id}: ${read.error.message}`);

  return { inInbox: read.value.isInInbox, labels: read.value.providerLabels };
}

describe("run --apply", () => {
  it("carries out the plan and says what it did", async () => {
    const harness = await cleanableRun([anEmail()]);

    try {
      expect(await runCli(["run", "--apply", "--since", "7d"], harness.deps)).toBe(EXIT.ok);

      const output = harness.output();

      expect(output).toContain("Applying this now");
      expect(output).toContain("applied");
      expect(output).toContain("Reverse all of it with: cleamail undo --last");
      expect(output).not.toContain("Nothing in your mailbox was changed.");

      const after = await mailbox(harness);

      expect(after.inInbox).toBe(false);
      expect(after.labels).toContain("cleamail/Cleaned");
    } finally {
      harness.close();
    }
  });

  it("records every action with the state it found, so undo has something to reverse", async () => {
    const harness = await cleanableRun([anEmail()]);

    try {
      await runCli(["run", "--apply"], harness.deps);

      const stored = await harness.store.decisions.listDecisions({ accountId: ACCOUNT.id });

      expect(stored.ok && stored.value).toHaveLength(1);
      expect(stored.ok && stored.value[0]?.dryRun).toBe(false);
      expect(stored.ok && stored.value[0]?.appliedAt).toBeDefined();
      expect(
        stored.ok && stored.value[0]?.actions.map((action) => action.action.type).sort(),
      ).toStrictEqual(["archive", "label"]);
      expect(stored.ok && stored.value[0]?.actions.every((a) => a.outcome === "applied")).toBe(
        true,
      );

      const audit = await harness.store.audit.list();

      expect(audit.ok && audit.value.map((entry) => entry.kind)).toContain("apply");
    } finally {
      harness.close();
    }
  });

  it("changes nothing without the flag, and records the preview instead", async () => {
    const harness = await cleanableRun([anEmail()]);

    try {
      expect(await runCli(["run"], harness.deps)).toBe(EXIT.ok);
      expect(harness.output()).toContain("Nothing in your mailbox was changed.");

      const after = await mailbox(harness);

      expect(after.inInbox).toBe(true);
      expect(after.labels).not.toContain("cleamail/Cleaned");

      const stored = await harness.store.decisions.listDecisions({ accountId: ACCOUNT.id });

      expect(stored.ok && stored.value[0]?.dryRun).toBe(true);
      expect(stored.ok && stored.value[0]?.actions).toStrictEqual([]);
    } finally {
      harness.close();
    }
  });

  it("treats --dry-run as the final word when both flags are given", async () => {
    const harness = await cleanableRun([anEmail()]);

    try {
      expect(await runCli(["run", "--apply", "--dry-run"], harness.deps)).toBe(EXIT.ok);
      expect(harness.output()).toContain("Nothing in your mailbox was changed.");
      expect((await mailbox(harness)).inInbox).toBe(true);
    } finally {
      harness.close();
    }
  });

  it("refuses a read-only mailbox, names the fix, and changes nothing", async () => {
    const harness = await cleanableRun([anEmail()], { canModify: false });

    try {
      expect(await runCli(["run", "--apply"], harness.deps)).toBe(EXIT.failure);
      expect(harness.errors()).toContain("read-only");

      expect((await mailbox(harness)).inInbox).toBe(true);

      const audit = await harness.store.audit.list();

      expect(audit.ok && audit.value[0]?.kind).toBe("refuse");
    } finally {
      harness.close();
    }
  });

  it("still previews on a read-only mailbox, which is the point of read-only", async () => {
    const harness = await cleanableRun([anEmail()], { canModify: false });

    try {
      expect(await runCli(["run"], harness.deps)).toBe(EXIT.ok);
      expect(harness.output()).toContain("Nothing in your mailbox was changed.");
    } finally {
      harness.close();
    }
  });

  it("reports an email it could not change and carries on with the rest", async () => {
    const harness = await cleanableRun([anEmail(), anEmail({ id: emailId("msg-2") })]);

    try {
      harness.provider.failOn(emailId("msg-1"), {
        code: "not_found",
        message: "No message msg-1.",
      });

      expect(await runCli(["run", "--apply"], harness.deps)).toBe(EXIT.ok);

      const output = harness.output();

      expect(output).toContain("failed     1 email(s)");
      expect(output).toContain("msg-1");
      expect((await mailbox(harness, "msg-2")).inInbox).toBe(false);
    } finally {
      harness.close();
    }
  });
});

describe("undo", () => {
  it("puts the mailbox back the way it was", async () => {
    const harness = await cleanableRun([anEmail()]);

    try {
      await runCli(["run", "--apply"], harness.deps);
      expect((await mailbox(harness)).inInbox).toBe(false);

      expect(await runCli(["undo", "--last"], harness.deps)).toBe(EXIT.ok);

      const after = await mailbox(harness);

      expect(after.inInbox).toBe(true);
      expect(after.labels).not.toContain("cleamail/Cleaned");
      expect(harness.output()).toContain("restored   1 email(s)");
    } finally {
      harness.close();
    }
  });

  it("does nothing the second time, and says so", async () => {
    const harness = await cleanableRun([anEmail()]);

    try {
      await runCli(["run", "--apply"], harness.deps);
      await runCli(["undo", "--last"], harness.deps);

      expect(await runCli(["undo"], harness.deps)).toBe(EXIT.ok);
      expect(harness.output()).toContain("already been undone");
      expect((await mailbox(harness)).inInbox).toBe(true);
    } finally {
      harness.close();
    }
  });

  it("says there is nothing to undo before anything was applied", async () => {
    const harness = await cleanableRun([anEmail()]);

    try {
      await runCli(["run"], harness.deps);

      expect(await runCli(["undo", "--last"], harness.deps)).toBe(EXIT.failure);
      expect(harness.errors()).toContain("nothing to undo");
    } finally {
      harness.close();
    }
  });

  it("undoes one email when asked for one", async () => {
    const harness = await cleanableRun([anEmail(), anEmail({ id: emailId("msg-2") })]);

    try {
      await runCli(["run", "--apply"], harness.deps);

      expect(await runCli(["undo", "--email", "msg-2"], harness.deps)).toBe(EXIT.ok);

      expect((await mailbox(harness, "msg-1")).inInbox).toBe(false);
      expect((await mailbox(harness, "msg-2")).inInbox).toBe(true);
    } finally {
      harness.close();
    }
  });

  it("refuses a command line that asks for two different runs", async () => {
    const harness = await createHarness();

    try {
      expect(await runCli(["undo", "--last", "--run", "run-1"], harness.deps)).toBe(EXIT.usage);
      expect(harness.errors()).toContain("not both");
    } finally {
      harness.close();
    }
  });

  it("writes the undo to the audit log, in counts", async () => {
    const harness = await cleanableRun([anEmail()]);

    try {
      await runCli(["run", "--apply"], harness.deps);
      await runCli(["undo"], harness.deps);

      const audit = await harness.store.audit.list();
      const kinds = audit.ok ? audit.value.map((entry) => entry.kind) : [];

      expect(kinds).toContain("undo");
      expect(audit.ok && audit.value[0]?.summary).toContain("Undid");
    } finally {
      harness.close();
    }
  });
});
