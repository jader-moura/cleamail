import { POLICY_VERSION, emailId, type Decision } from "@cleamail/core";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openInMemoryStore, type Store } from "../store.js";
import { TEST_ACCOUNT, anEmail } from "../test/fixtures.js";

const DECIDED_AT = new Date("2026-10-02T09:00:00.000Z");
const APPLIED_AT = new Date("2026-10-02T09:00:01.000Z");

function aDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    emailId: emailId("msg-1"),
    accountId: TEST_ACCOUNT.id,
    classification: {
      category: "promotion",
      importance: 0.1,
      confidence: 0.92,
      reason: "It offers a discount.",
      source: "model",
      model: "test-model",
    },
    actions: [
      { type: "label", label: "cleamail/Cleaned", hadLabel: false },
      { type: "archive", wasInInbox: true },
    ],
    policyVersion: POLICY_VERSION,
    decidedAt: DECIDED_AT,
    ...overrides,
  };
}

describe("SqliteDecisionStore", () => {
  let store: Store;

  beforeEach(async () => {
    store = openInMemoryStore();
    await store.accounts.upsert(TEST_ACCOUNT);
    await store.emails.saveEmails([anEmail({ id: emailId("msg-1") })]);
  });

  afterEach(() => {
    store.close();
  });

  it("round-trips a decision with its actions", async () => {
    const decision = aDecision();

    const saved = await store.decisions.saveDecision({
      decision,
      runId: "run-1",
      dryRun: false,
      appliedAt: APPLIED_AT,
      actions: decision.actions.map((action) => ({ action, outcome: "applied" as const })),
    });

    expect(saved.ok).toBe(true);

    const listed = await store.decisions.listDecisions({ accountId: TEST_ACCOUNT.id });

    expect(listed.ok && listed.value).toHaveLength(1);
    expect(listed.ok && listed.value[0]?.decision).toStrictEqual(decision);
    expect(listed.ok && listed.value[0]?.actions.map((action) => action.outcome)).toStrictEqual([
      "applied",
      "applied",
    ]);
    // The before-state travels with the row, because that is what undo reverses from.
    expect(listed.ok && listed.value[0]?.actions[1]?.action).toStrictEqual({
      type: "archive",
      wasInInbox: true,
    });
  });

  it("stores a decision the model could not classify", async () => {
    const decision = aDecision({
      classification: undefined,
      reviewReason: "invalid_model_output",
      reviewDetail: "test-model answered with reasoning and no classification.",
      actions: [{ type: "label", label: "cleamail/Review", hadLabel: false }],
    });

    const saved = await store.decisions.saveDecision({
      decision,
      runId: "run-1",
      dryRun: false,
      appliedAt: APPLIED_AT,
      actions: [
        { action: decision.actions[0] ?? { type: "star", wasStarred: false }, outcome: "applied" },
      ],
    });

    expect(saved.ok).toBe(true);

    const listed = await store.decisions.listDecisions({ accountId: TEST_ACCOUNT.id });
    const stored = listed.ok ? listed.value[0]?.decision : undefined;

    expect(stored?.classification).toBeUndefined();
    expect(stored?.reviewReason).toBe("invalid_model_output");
    expect(stored?.reviewDetail).toContain("reasoning");
  });

  it("records a dry run with no action rows, because nothing was done", async () => {
    const saved = await store.decisions.saveDecision({
      decision: aDecision(),
      runId: "preview-1",
      dryRun: true,
    });

    expect(saved.ok && saved.value.actions).toStrictEqual([]);

    const listed = await store.decisions.listDecisions({ accountId: TEST_ACCOUNT.id });

    expect(listed.ok && listed.value[0]?.dryRun).toBe(true);
    expect(listed.ok && listed.value[0]?.appliedAt).toBeUndefined();
  });

  it("filters by run and by email", async () => {
    await store.emails.saveEmails([anEmail({ id: emailId("msg-2") })]);

    await store.decisions.saveDecision({ decision: aDecision(), runId: "run-1", dryRun: false });
    await store.decisions.saveDecision({
      decision: aDecision({ emailId: emailId("msg-2") }),
      runId: "run-2",
      dryRun: false,
    });

    const run = await store.decisions.listDecisions({
      accountId: TEST_ACCOUNT.id,
      runId: "run-2",
    });
    const email = await store.decisions.listDecisions({
      accountId: TEST_ACCOUNT.id,
      emailId: emailId("msg-1"),
    });

    expect(run.ok && run.value).toHaveLength(1);
    expect(run.ok && run.value[0]?.decision.emailId).toBe("msg-2");
    expect(email.ok && email.value).toHaveLength(1);
    expect(email.ok && email.value[0]?.decision.emailId).toBe("msg-1");
  });

  it("replaces the planned outcome once the provider has answered", async () => {
    const decision = aDecision();
    const saved = await store.decisions.saveDecision({
      decision,
      runId: "run-1",
      dryRun: false,
      actions: decision.actions.map((action) => ({ action, outcome: "planned" as const })),
    });

    expect(saved.ok && saved.value.appliedAt).toBeUndefined();

    const completed = await store.decisions.completeActions({
      decisionId: saved.ok ? saved.value.id : 0,
      actionIds: saved.ok ? saved.value.actions.map((action) => action.id) : [],
      outcome: "applied",
      at: APPLIED_AT,
    });

    expect(completed).toStrictEqual({ ok: true, value: 2 });

    const listed = await store.decisions.listDecisions({ accountId: TEST_ACCOUNT.id });

    expect(listed.ok && listed.value[0]?.actions.every((a) => a.outcome === "applied")).toBe(true);
    // The decision and its actions agree, because both were written in one transaction.
    expect(listed.ok && listed.value[0]?.appliedAt).toStrictEqual(APPLIED_AT);
  });

  it("records why an action failed, and leaves the decision unapplied", async () => {
    const decision = aDecision();
    const saved = await store.decisions.saveDecision({
      decision,
      runId: "run-1",
      dryRun: false,
      actions: decision.actions.map((action) => ({ action, outcome: "planned" as const })),
    });

    await store.decisions.completeActions({
      decisionId: saved.ok ? saved.value.id : 0,
      actionIds: saved.ok ? saved.value.actions.map((action) => action.id) : [],
      outcome: "failed",
      at: APPLIED_AT,
      error: "No message msg-1.",
    });

    const listed = await store.decisions.listDecisions({ accountId: TEST_ACCOUNT.id });

    expect(listed.ok && listed.value[0]?.actions[0]?.outcome).toBe("failed");
    expect(listed.ok && listed.value[0]?.actions[0]?.error).toBe("No message msg-1.");
    expect(listed.ok && listed.value[0]?.appliedAt).toBeUndefined();
  });

  it("completes a planned row once, so a retry cannot double-count it", async () => {
    const decision = aDecision();
    const saved = await store.decisions.saveDecision({
      decision,
      runId: "run-1",
      dryRun: false,
      actions: [
        { action: decision.actions[0] ?? { type: "star", wasStarred: false }, outcome: "planned" },
      ],
    });

    const ids = saved.ok ? saved.value.actions.map((action) => action.id) : [];
    const complete = {
      decisionId: saved.ok ? saved.value.id : 0,
      actionIds: ids,
      outcome: "applied" as const,
      at: APPLIED_AT,
    };

    expect(await store.decisions.completeActions(complete)).toStrictEqual({ ok: true, value: 1 });
    expect(await store.decisions.completeActions(complete)).toStrictEqual({ ok: true, value: 0 });
  });

  it("finds the last run that applied something, ignoring previews", async () => {
    const applied = aDecision();
    const saved = await store.decisions.saveDecision({
      decision: applied,
      runId: "applied-1",
      dryRun: false,
      actions: applied.actions.map((action) => ({ action, outcome: "planned" as const })),
    });

    await store.decisions.completeActions({
      decisionId: saved.ok ? saved.value.id : 0,
      actionIds: saved.ok ? saved.value.actions.map((action) => action.id) : [],
      outcome: "applied",
      at: APPLIED_AT,
    });
    await store.decisions.saveDecision({
      decision: aDecision(),
      runId: "preview-2",
      dryRun: true,
    });

    expect(await store.decisions.lastAppliedRunId(TEST_ACCOUNT.id)).toStrictEqual({
      ok: true,
      value: "applied-1",
    });
  });

  it("has nothing to undo before anything was applied", async () => {
    expect(await store.decisions.lastAppliedRunId(TEST_ACCOUNT.id)).toStrictEqual({
      ok: true,
      value: undefined,
    });
  });

  it("does not call a run applied when every action only ever failed", async () => {
    const decision = aDecision();
    const saved = await store.decisions.saveDecision({
      decision,
      runId: "run-1",
      dryRun: false,
      actions: decision.actions.map((action) => ({ action, outcome: "planned" as const })),
    });

    await store.decisions.completeActions({
      decisionId: saved.ok ? saved.value.id : 0,
      actionIds: saved.ok ? saved.value.actions.map((action) => action.id) : [],
      outcome: "failed",
      at: APPLIED_AT,
      error: "No message msg-1.",
    });

    expect(await store.decisions.lastAppliedRunId(TEST_ACCOUNT.id)).toStrictEqual({
      ok: true,
      value: undefined,
    });
  });

  it("marks actions reversed once, so a second undo changes nothing", async () => {
    const decision = aDecision();
    const saved = await store.decisions.saveDecision({
      decision,
      runId: "run-1",
      dryRun: false,
      appliedAt: APPLIED_AT,
      actions: decision.actions.map((action) => ({ action, outcome: "applied" as const })),
    });

    const ids = saved.ok ? saved.value.actions.map((action) => action.id) : [];
    const reversedAt = new Date("2026-10-02T10:00:00.000Z");

    expect(await store.decisions.markReversed(ids, reversedAt)).toStrictEqual({
      ok: true,
      value: 2,
    });
    expect(await store.decisions.markReversed(ids, reversedAt)).toStrictEqual({
      ok: true,
      value: 0,
    });

    const listed = await store.decisions.listDecisions({ accountId: TEST_ACCOUNT.id });

    expect(
      listed.ok && listed.value[0]?.actions.every((action) => action.outcome === "reversed"),
    ).toBe(true);
    expect(listed.ok && listed.value[0]?.actions[0]?.reversedAt).toStrictEqual(reversedAt);
  });

  it("refuses to hand back an action whose payload cannot be read", async () => {
    const decision = aDecision();
    await store.decisions.saveDecision({
      decision,
      runId: "run-1",
      dryRun: false,
      appliedAt: APPLIED_AT,
      actions: [
        { action: decision.actions[1] ?? { type: "star", wasStarred: false }, outcome: "applied" },
      ],
    });

    // A hand-edited or half-migrated row. Undo must not guess what it meant.
    store.db.run(sql`UPDATE actions SET payload_json = '{"type":"explode"}'`);

    const listed = await store.decisions.listDecisions({ accountId: TEST_ACCOUNT.id });

    expect(listed.ok).toBe(false);
    expect(!listed.ok && listed.error.message).toContain("cannot be undone safely");
  });
});
