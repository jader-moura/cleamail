import { describe, expect, it } from "vitest";
import { domainError } from "../result.js";
import { emailId, type EmailId } from "../domain/ids.js";
import { LABEL_CLEANED, LABEL_REVIEW } from "../domain/labels.js";
import { POLICY_VERSION } from "../policy/decide.js";
import type { Decision } from "../domain/decision.js";
import { applyDecisions, type ExecuteDeps } from "./apply.js";
import {
  MemoryAuditLog,
  MemoryDecisionStore,
  RecordingMailbox,
  TEST_ACCOUNT_ID,
} from "./test/doubles.js";

const NOW = new Date("2026-10-02T09:00:00.000Z");

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
  readonly deps: ExecuteDeps;
};

function harness(
  provider = new RecordingMailbox(),
  decisions = new MemoryDecisionStore(),
): Harness {
  const audit = new MemoryAuditLog();

  return {
    provider,
    decisions,
    audit,
    deps: { provider, decisions, audit, runId: "run-1", now: NOW },
  };
}

describe("applyDecisions", () => {
  it("applies the planned actions and records them", async () => {
    const cli = harness();

    const summary = await applyDecisions(
      { accountId: TEST_ACCOUNT_ID, decisions: [aDecision("msg-1")] },
      cli.deps,
    );

    expect(summary.ok && summary.value).toMatchObject({
      runId: "run-1",
      dryRun: false,
      emailsChanged: 1,
      applied: 2,
      skipped: 0,
      failed: 0,
    });
    expect(cli.provider.calls).toHaveLength(1);
    expect(cli.provider.calls[0]?.direction).toBe("apply");
    expect(cli.decisions.all()[0]?.actions.map((action) => action.outcome)).toStrictEqual([
      "applied",
      "applied",
    ]);
    expect(cli.decisions.all()[0]?.appliedAt).toStrictEqual(NOW);
  });

  it("creates the labels the plans need, once, before anything is applied", async () => {
    const cli = harness();

    await applyDecisions(
      {
        accountId: TEST_ACCOUNT_ID,
        decisions: [
          aDecision("msg-1"),
          aDecision("msg-2"),
          aDecision("msg-3", {
            classification: undefined,
            reviewReason: "invalid_model_output",
            actions: [{ type: "label", label: LABEL_REVIEW, hadLabel: false }],
          }),
        ],
      },
      cli.deps,
    );

    expect(cli.provider.ensured).toHaveLength(1);
    expect(cli.provider.ensured[0]?.sort()).toStrictEqual([LABEL_CLEANED, LABEL_REVIEW].sort());
  });

  it("never sends an action that would change nothing", async () => {
    const cli = harness();

    const summary = await applyDecisions(
      {
        accountId: TEST_ACCOUNT_ID,
        decisions: [
          aDecision("msg-1", {
            actions: [
              { type: "label", label: LABEL_CLEANED, hadLabel: true },
              { type: "archive", wasInInbox: true },
            ],
          }),
        ],
      },
      cli.deps,
    );

    expect(summary.ok && summary.value.applied).toBe(1);
    expect(summary.ok && summary.value.skipped).toBe(1);
    expect(cli.provider.calls[0]?.actions).toStrictEqual([{ type: "archive", wasInInbox: true }]);
    // The no-op is still a row: the record says what was planned and that it changed nothing.
    expect(cli.decisions.all()[0]?.actions.map((action) => action.outcome)).toStrictEqual([
      "applied",
      "skipped",
    ]);
  });

  it("touches nothing when every planned action is already true of the message", async () => {
    const cli = harness();

    const summary = await applyDecisions(
      {
        accountId: TEST_ACCOUNT_ID,
        decisions: [aDecision("msg-1", { actions: [{ type: "star", wasStarred: true }] })],
      },
      cli.deps,
    );

    expect(cli.provider.calls).toHaveLength(0);
    expect(summary.ok && summary.value).toMatchObject({ emailsChanged: 0, skipped: 1 });
    expect(cli.decisions.all()[0]?.actions[0]?.outcome).toBe("skipped");
  });

  it("refuses a read-only mailbox before trying anything, and says why", async () => {
    const cli = harness(new RecordingMailbox({ canModify: false }));

    const summary = await applyDecisions(
      { accountId: TEST_ACCOUNT_ID, decisions: [aDecision("msg-1")] },
      cli.deps,
    );

    expect(summary.ok).toBe(false);
    expect(!summary.ok && summary.error.code).toBe("unsupported_operation");
    expect(!summary.ok && summary.error.message).toContain("read-only");
    expect(cli.provider.calls).toHaveLength(0);
    expect(cli.provider.ensured).toHaveLength(0);
    expect(cli.decisions.all()).toHaveLength(0);
    // Written down, so a user who closed the terminal can still find out why nothing happened.
    expect(cli.audit.kinds()).toStrictEqual(["refuse"]);
  });

  it("explains a refusal in its own words when the provider gave none", async () => {
    const cli = harness(new RecordingMailbox({ silentRefusal: true }));

    const summary = await applyDecisions(
      { accountId: TEST_ACCOUNT_ID, decisions: [aDecision("msg-1")] },
      cli.deps,
    );

    expect(!summary.ok && summary.error.message).toContain("init");
    expect(cli.provider.calls).toHaveLength(0);
  });

  it("stops when it cannot even find out what it is allowed to do", async () => {
    const cli = harness(
      new RecordingMailbox({
        failCapabilities: domainError("provider_auth", "The token was rejected."),
      }),
    );

    const summary = await applyDecisions(
      { accountId: TEST_ACCOUNT_ID, decisions: [aDecision("msg-1")] },
      cli.deps,
    );

    expect(summary.ok).toBe(false);
    expect(!summary.ok && summary.error.code).toBe("provider_auth");
    expect(cli.provider.calls).toHaveLength(0);
    expect(cli.audit.entries).toHaveLength(0);
  });

  it("stores the decisions and changes nothing on a dry run", async () => {
    const cli = harness();

    const summary = await applyDecisions(
      { accountId: TEST_ACCOUNT_ID, decisions: [aDecision("msg-1")], dryRun: true },
      cli.deps,
    );

    expect(summary.ok && summary.value).toMatchObject({ dryRun: true, applied: 0, skipped: 0 });
    expect(cli.provider.calls).toHaveLength(0);
    expect(cli.provider.ensured).toHaveLength(0);
    expect(cli.decisions.all()[0]?.dryRun).toBe(true);
    expect(cli.decisions.all()[0]?.actions).toStrictEqual([]);
    expect(cli.audit.kinds()).toStrictEqual(["decide"]);
  });

  it("does not check capabilities for a dry run, which a read-only mailbox may do", async () => {
    const cli = harness(new RecordingMailbox({ canModify: false }));

    const summary = await applyDecisions(
      { accountId: TEST_ACCOUNT_ID, decisions: [aDecision("msg-1")], dryRun: true },
      cli.deps,
    );

    expect(summary.ok).toBe(true);
  });

  it("records a failure about one message and carries on with the rest", async () => {
    const cli = harness(
      new RecordingMailbox({
        failWith: { "msg-1": domainError("not_found", "No message msg-1.") },
      }),
    );

    const summary = await applyDecisions(
      { accountId: TEST_ACCOUNT_ID, decisions: [aDecision("msg-1"), aDecision("msg-2")] },
      cli.deps,
    );

    expect(summary.ok && summary.value).toMatchObject({ emailsChanged: 1, failed: 1 });
    expect(summary.ok && summary.value.failures[0]?.emailId).toBe("msg-1");
    expect(cli.decisions.all()[0]?.actions.every((action) => action.outcome === "failed")).toBe(
      true,
    );
    expect(cli.decisions.all()[0]?.actions[0]?.error).toContain("No message");
    expect(cli.audit.kinds()).toStrictEqual(["fail", "apply"]);
  });

  it("stops when the failure is about the mailbox rather than one message", async () => {
    const cli = harness(
      new RecordingMailbox({
        failWith: { "msg-1": domainError("provider_auth", "The token was rejected.") },
      }),
    );

    const summary = await applyDecisions(
      { accountId: TEST_ACCOUNT_ID, decisions: [aDecision("msg-1"), aDecision("msg-2")] },
      cli.deps,
    );

    expect(summary.ok).toBe(false);
    expect(!summary.ok && summary.error.message).toContain("stopped at msg-1");
    // The second email was never attempted, and the first is recorded as failed.
    expect(cli.decisions.all()).toHaveLength(1);
  });

  it("stops when the labels it needs cannot be created", async () => {
    const cli = harness(
      new RecordingMailbox({
        failEnsureLabels: domainError("provider_unavailable", "Gmail did not answer."),
      }),
    );

    const summary = await applyDecisions(
      { accountId: TEST_ACCOUNT_ID, decisions: [aDecision("msg-1")] },
      cli.deps,
    );

    expect(summary.ok).toBe(false);
    expect(cli.provider.calls).toHaveLength(0);
    expect(cli.decisions.all()).toHaveLength(0);
  });

  it("writes the plan down before touching anything, so a failed write changes nothing", async () => {
    const store = new MemoryDecisionStore(domainError("store_failure", "The disk is full."));
    const cli = harness(new RecordingMailbox(), store);

    const summary = await applyDecisions(
      { accountId: TEST_ACCOUNT_ID, decisions: [aDecision("msg-1"), aDecision("msg-2")] },
      cli.deps,
    );

    expect(summary.ok).toBe(false);
    expect(!summary.ok && summary.error.code).toBe("store_failure");
    // The mailbox is untouched: the record is written first on purpose.
    expect(cli.provider.calls).toHaveLength(0);
  });

  it("stops and says so when it cannot record what it just did", async () => {
    const store = new MemoryDecisionStore(
      undefined,
      domainError("store_failure", "The disk is full."),
    );
    const cli = harness(new RecordingMailbox(), store);

    const summary = await applyDecisions(
      { accountId: TEST_ACCOUNT_ID, decisions: [aDecision("msg-1"), aDecision("msg-2")] },
      cli.deps,
    );

    expect(summary.ok).toBe(false);
    // One email was changed, and its planned rows are still on disk saying what was attempted,
    // which is what makes this recoverable rather than invisible.
    expect(cli.provider.calls).toHaveLength(1);
    expect(store.all()[0]?.actions.every((action) => action.outcome === "planned")).toBe(true);
  });

  it("summarizes the run in the audit log, in counts rather than content", async () => {
    const cli = harness();

    await applyDecisions(
      { accountId: TEST_ACCOUNT_ID, decisions: [aDecision("msg-1"), aDecision("msg-2")] },
      cli.deps,
    );

    const entry = cli.audit.entries.at(-1);

    expect(entry?.kind).toBe("apply");
    expect(entry?.summary).toBe("Applied 4 action(s) to 2 email(s)");
    expect(entry?.details).toStrictEqual({
      runId: "run-1",
      decisions: 2,
      applied: 4,
      skipped: 0,
      failed: 0,
    });
  });

  it("accounts for every email it was given", async () => {
    const cli = harness(
      new RecordingMailbox({
        failWith: { "msg-3": domainError("not_found", "No message msg-3.") },
      }),
    );

    const ids: EmailId[] = ["msg-1", "msg-2", "msg-3", "msg-4"].map((id) => emailId(id));
    const summary = await applyDecisions(
      {
        accountId: TEST_ACCOUNT_ID,
        decisions: [
          aDecision(ids[0] ?? "msg-1"),
          aDecision(ids[1] ?? "msg-2", { actions: [{ type: "star", wasStarred: true }] }),
          aDecision(ids[2] ?? "msg-3"),
          aDecision(ids[3] ?? "msg-4", { actions: [] }),
        ],
      },
      cli.deps,
    );

    expect(summary.ok && summary.value).toMatchObject({
      emailsChanged: 1,
      applied: 2,
      skipped: 1,
      failed: 1,
    });
    // One row per email, whatever happened to it.
    expect(cli.decisions.all()).toHaveLength(4);
  });
});
