# SPEC-011: Policy engine

- Phase: v0.1 - 3. Act safely
- Status: done

## Goal

One deterministic function that turns a classification into a plan. It is the only place in cleamail
that decides what happens to an email, it reaches nothing and changes nothing, and it is the piece
that has to be right for the first promise to hold.

## Scope

- `packages/core/src/policy`: the settings, the engine, and the one sentence that explains a
  decision to the user.
- `packages/core/src/domain/decision.ts` widened, because an email the model could not classify
  still gets a decision.
- `packages/evals/src/grade.ts` now asks the engine whether a miss would have been acted on, which
  is the carried-forward constraint SPEC-010 left here.
- `apps/cli`: the dry run says what would happen, as a summary. Still applies nothing.

## Decisions

- **The engine is a pure function of the email, the outcome and the settings.** No clock inside it,
  no store, no provider. `decidedAt` is passed in. That is what lets the whole policy be covered by
  tests that enumerate every category against every review state, which is how a near-100% target
  stops being a hope.
- **A decision without a classification is still a decision.** When the model returns something
  invalid, the plan is to label `cleamail/Review` and stop, and that has to be recordable: an audit
  log missing exactly the cases that went wrong is the one you cannot trust. So
  `Decision.classification` is optional, and `reviewReason` sits next to it.
- **The explanation is derived, not stored.** `explainDecision` prefers the classification's own
  reason and falls back to the review reason. Freezing a sentence into the row would let it drift
  from the classification it claims to explain, and `policyVersion` is already there to keep an old
  decision readable.
- **Overrides can only take actions away.** The engine plans from the category, then applies the
  safety overrides as a filter. An allowlisted sender and a message the user starred both lose every
  action that would move the message out of the inbox. Writing it as a filter rather than as
  branches means "no override can ever add an action" is a property, and it is tested as one.
- **The allowlist is checked here as well as in the rules layer.** The rules layer already turns an
  allowlisted sender into `important`, so this is the second belt. A correction, a reordering, or a
  future rule could produce a cleanable category for a sender the user said never to touch, and the
  cost of checking twice is one array lookup.
- **`fyi` gets no action at all.** It is in neither the protected nor the cleanable set, so it keeps
  its place in the inbox with no label and no star. Doing nothing is the decision, and the summary
  says so rather than leaving those emails unaccounted for.
- **`suspicious` gets `cleamail/Suspicious`, and review items get `cleamail/Review`.** One label
  each rather than both, because two labels on one message tells the user less, not more. The review
  list is driven by `reviewReason`, not by which label was applied.
- **The engine can never produce `trash`.** The opt-in trash rule is SPEC-016 and runs later, over
  mail that has already sat in `cleamail/Cleaned` for N days. A test asserts that no combination of
  category, review state, email state and settings produces a trash action, so the rule cannot be
  reached by accident before the spec that is allowed to reach it.
- **Actions are planned even when they would change nothing.** Each one records the state it found,
  `isNoOp` already exists, and the executor skips them. Planning freely keeps the engine a function
  of the classification rather than of the mailbox's current state, and it keeps the audit log
  honest about what actually changed.
- **Archiving is a setting, and label-only is a supported way to run.** `archiveCleaned: false`
  leaves every cleanable email in the inbox with a label, which is how a cautious user tries
  cleamail for a week. The engine treats it as a first-class mode rather than a debug flag.
- **Cleaned mail is not marked read by default.** Unread is how a user finds what they have not
  seen. The setting exists because some people want an empty bold count, but the default does not
  hide anything from anyone.
- **The settings are the only place a threshold lives.** The confidence threshold is a policy
  setting the user edits, so the pipeline is told it from `PolicySettings` rather than from a
  parameter beside it. The eval's `--threshold` writes to the settings, the CLI passes the defaults
  from the same object, and the report prints what the run actually classified by. Two sources would
  let a run report one number and use another, which is the kind of discrepancy that makes a safety
  measurement worthless.
- **"Under 1%" is read strictly.** A run that lands exactly on the target has not met a target of
  "under 1%", so `meetsDangerousTarget` compares with `<` and the gate fails on equality. The first
  baseline sat on exactly 1.0% and the report called it "Within the target", which is the one place
  cleamail must never round in its own favour. A run with no dangerous misses at all meets any
  target, including zero.
- **Review items say why in cleamail's words.** The dry run prints `explainDecision` under an email
  the model could not classify, which is the sentence the adapter wrote, never the email's text. The
  eval report has had that since SPEC-010; "model output invalid" with nothing after it leaves a
  user with nothing to act on.
- **The eval now asks the engine, not the category list.** SPEC-010 decided "would this have been
  acted on" by reading `CLEANABLE_CATEGORIES` and the review flag, which was the documented default
  standing in for the real thing. Now a dangerous miss is an email of a protected category for which
  the engine planned an action that removes it from the inbox. The safety metric and the product can
  no longer disagree about what would have happened.

## Out of scope

- Applying anything. The executor, the audit log and undo are SPEC-012. Every action here is a plan.
- The opt-in trash rule and the settings UI, which are SPEC-016.
- Persisting decisions, which needs the decision store in SPEC-012.
- Reading settings from anywhere. The engine takes them as an argument and the CLI passes the
  defaults until SPEC-016 stores them.
- The read-only token check the phase carries forward. A decision can be computed from a
  `gmail.readonly` mailbox perfectly well; it is applying one that has to check `canModify`, so that
  belongs with the executor in SPEC-012.

## What measuring it showed

`packages/core/src/policy` is at 100% of statements, branches, functions and lines, which is what
the enumeration test buys: every category against every review state, every email state and every
settings combination, 800 plans in one assertion loop.

Re-running the full eval with the metric asked of the engine rather than worked out from the
category list reproduced SPEC-010's baseline exactly: the same 3 dangerous misses, all three
`crypto-giveaway`, and the same single must-not failure, `injection-json-output-03`. That is the
result worth having. The stand-in was right, and now it cannot quietly stop being right.

The eval report also prints the archiving mode, because it has to. Running the same 300 cases both
ways shows why: 3 dangerous misses with archiving on, 0 with `--label-only`, and the same single
must-not failure in both. Nothing about the classifier improved between those two runs. A safety
number that does not say which policy it is true of is not a safety number, and the must-not count
holding steady is the check that the two measures are independent: an injection landing is a
classification failure whatever the policy does afterwards.

Measuring the gate itself turned up the one thing the first pass got wrong. The baseline's 3
dangerous misses in 300 cases is exactly 1.0%, and the report printed "Within the target" against a
target of "under 1%", because the comparison allowed equality. The same comparison was in `--gate`,
so CI would have passed a run at the boundary. It is strict now, and the test that proves it builds
a run of exactly one dangerous miss in a hundred cases rather than asserting on the operator.

The smoke set, re-run after the change: 0 dangerous misses, 18 of 20 correct, 2 sent to review, gate
green. Measured on `qwen3-vl:8b-instruct`, still not the documented default.

## Acceptance

- Every category, in every review state, produces exactly the actions the defaults in CLAUDE.md
  describe, enumerated in a test rather than sampled.
- No input produces a `trash` action.
- No protected category is ever archived.
- An allowlisted sender and a starred message are never archived, whatever the classification says.
- An outcome with no classification produces a `cleamail/Review` label and nothing else.
- With `archiveCleaned: false`, no email is ever removed from the inbox.
- Every planned action carries the state needed to reverse it.
- `pnpm eval` reports the same kind of dangerous miss as before, now derived from the engine.
- The dry run prints what would happen, and the counts account for every email in the run.
- The threshold a run reports is the threshold it classified by, because both come from the
  settings.
- A dangerous miss rate exactly on the target fails the gate and does not read as "within" it.
- An email the model could not classify carries a sentence saying why, in the dry run as well as in
  the eval report.
