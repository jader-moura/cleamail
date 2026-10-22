import { describe, expect, it } from "vitest";
import { domainError } from "../result.js";
import { emailId } from "../domain/ids.js";
import { LABEL_CLEANED } from "../domain/labels.js";
import { POLICY_VERSION } from "../policy/decide.js";
import type { Decision } from "../domain/decision.js";
import { applyDecisions, type ExecuteDeps } from "./apply.js";
import { reversible, undoRun } from "./undo.js";
import {
  MemoryAuditLog,
  MemoryDecisionStore,
  RecordingMailbox,
  TEST_ACCOUNT_ID,
} from "./test/doubles.js";

const NOW = new Date("2026-10-02T09:00:00.000Z");
const LATER = new Date("2026-10-02T10:00:00.000Z");

function aDecision(id: string, overrides: Partial<Decision> = {}): Decision {
  return {
    emailId: emailId(id),
    accountId: TEST_ACCOUNT_ID,
    classification: {
      category: "promotion",
      importance: 0.1,
      confidence: 0.9,
      reason: "It offers a discount.",
      source: "model",
      model: "test-model",
    },
    actions: [
      { type: "label", label: LABEL_CLEANED, hadLabel: false },
      { type: "archive", wasInInbox: true },
    ],
    policyVersion: POLICY_VERSION,
    decidedAt: NOW,
    ...overrides,
  };
}

type Harness = {
  readonly provider: RecordingMailbox;
  readonly decisions: MemoryDecisionStore;
  readonly audit: MemoryAuditLog;
  readonly apply: (runId: string, decisions: readonly Decision[]) => Promise<void>;
  readonly undo: (runId?: string, at?: Date) => ReturnType<typeof undoRun>;
};

function harness(provider = new RecordingMailbox()): Harness {
  const decisions = new MemoryDecisionStore();
  const audit = new MemoryAuditLog();

  const deps = (runId: string, now: Date): ExecuteDeps => ({
    provider,
    decisions,
    audit,
    runId,
    now,
  });

  return {
    provider,
    decisions,
    audit,
    apply: async (runId, planned) => {
      await applyDecisions({ accountId: TEST_ACCOUNT_ID, decisions: planned }, deps(runId, NOW));
    },
    undo: (runId, at = LATER) =>
      undoRun(
        { accountId: TEST_ACCOUNT_ID, ...(runId === undefined ? {} : { runId }) },
        deps("undo", at),
      ),
  };
}

describe("undoRun", () => {
  it("reverses everything the last applying run changed", async () => {
    const cli = harness();
    await cli.apply("run-1", [aDecision("msg-1"), aDecision("msg-2")]);

    const summary = await cli.undo();

    expect(summary.ok && summary.value).toMatchObject({
      runId: "run-1",
      emailsRestored: 2,
      reversed: 4,
      alreadyReversed: 0,
    });

    const reverses = cli.provider.calls.filter((call) => call.direction === "reverse");

    expect(reverses).toHaveLength(2);
    // Reversed from the record, with the before-state the action carried.
    expect(reverses[0]?.actions).toStrictEqual([
      { type: "label", label: LABEL_CLEANED, hadLabel: false },
      { type: "archive", wasInInbox: true },
    ]);
  });

  it("changes nothing the second time", async () => {
    const cli = harness();
    await cli.apply("run-1", [aDecision("msg-1")]);

    await cli.undo();
    const second = await cli.undo();

    expect(second.ok && second.value).toMatchObject({
      emailsRestored: 0,
      reversed: 0,
      alreadyReversed: 2,
    });
    expect(cli.provider.calls.filter((call) => call.direction === "reverse")).toHaveLength(1);
  });

  it("undoes the named run rather than the last one", async () => {
    const cli = harness();
    await cli.apply("run-1", [aDecision("msg-1")]);
    await cli.apply("run-2", [aDecision("msg-2")]);

    const summary = await cli.undo("run-1");

    expect(summary.ok && summary.value.runId).toBe("run-1");
    expect(
      cli.provider.calls.filter((call) => call.direction === "reverse").map((call) => call.emailId),
    ).toStrictEqual(["msg-1"]);
  });

  it("says there is nothing to undo rather than failing oddly", async () => {
    const cli = harness();

    const summary = await cli.undo();

    expect(summary.ok).toBe(false);
    expect(!summary.ok && summary.error.code).toBe("not_found");
    expect(!summary.ok && summary.error.message).toContain("nothing to undo");
  });

  it("never reverses a no-op or a failed action", async () => {
    const cli = harness(
      new RecordingMailbox({
        failWith: { "msg-2": domainError("not_found", "No message msg-2.") },
      }),
    );

    await cli.apply("run-1", [
      aDecision("msg-1", {
        actions: [
          { type: "label", label: LABEL_CLEANED, hadLabel: true },
          { type: "archive", wasInInbox: true },
        ],
      }),
      aDecision("msg-2"),
    ]);

    const summary = await cli.undo();

    expect(summary.ok && summary.value.reversed).toBe(1);

    const reverses = cli.provider.calls.filter((call) => call.direction === "reverse");

    expect(reverses).toHaveLength(1);
    expect(reverses[0]?.actions).toStrictEqual([{ type: "archive", wasInInbox: true }]);
  });

  it("leaves a decision alone when putting it back fails, so it can be tried again", async () => {
    const cli = harness(
      new RecordingMailbox({
        failReverseWith: { "msg-1": domainError("provider_unavailable", "Gmail did not answer.") },
      }),
    );
    await cli.apply("run-1", [aDecision("msg-1")]);

    const summary = await cli.undo();

    expect(summary.ok && summary.value.reversed).toBe(0);
    expect(summary.ok && summary.value.failures).toHaveLength(1);
    expect(cli.audit.kinds()).toContain("fail");

    // Still applied, not reversed: the next undo will try the same thing again.
    const second = await cli.undo();

    expect(second.ok && second.value.alreadyReversed).toBe(0);
    expect(second.ok && second.value.failures).toHaveLength(1);
  });

  it("refuses when the mailbox is read-only", async () => {
    const cli = harness();
    await cli.apply("run-1", [aDecision("msg-1")]);

    const readOnly = harness(new RecordingMailbox({ canModify: false }));
    const summary = await readOnly.undo("run-1");

    expect(summary.ok).toBe(false);
    expect(!summary.ok && summary.error.code).toBe("unsupported_operation");
  });

  it("explains a read-only refusal in its own words when the provider gave none", async () => {
    const cli = harness(new RecordingMailbox({ silentRefusal: true }));

    const summary = await cli.undo("run-1");

    expect(!summary.ok && summary.error.message).toContain("put back");
  });

  it("stops when it cannot find out whether it may act", async () => {
    const cli = harness(
      new RecordingMailbox({
        failCapabilities: domainError("provider_unavailable", "Gmail did not answer."),
      }),
    );

    const summary = await cli.undo("run-1");

    expect(summary.ok).toBe(false);
    expect(!summary.ok && summary.error.code).toBe("provider_unavailable");
  });

  it("writes one audit entry per undo, in counts", async () => {
    const cli = harness();
    await cli.apply("run-1", [aDecision("msg-1")]);

    await cli.undo();

    const entry = cli.audit.entries.at(-1);

    expect(entry?.kind).toBe("undo");
    expect(entry?.summary).toBe("Undid 2 action(s) on 1 email(s)");
  });
});

describe("reversible", () => {
  it("names only the actions an undo would send", async () => {
    const cli = harness();
    await cli.apply("run-1", [
      aDecision("msg-1", {
        actions: [
          { type: "label", label: LABEL_CLEANED, hadLabel: true },
          { type: "star", wasStarred: false },
        ],
      }),
    ]);

    const stored = cli.decisions.all()[0];

    expect(reversible(stored?.actions ?? [])).toStrictEqual([{ type: "star", wasStarred: false }]);
  });
});
