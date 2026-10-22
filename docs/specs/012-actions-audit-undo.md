# SPEC-012: Actions, audit log, undo

- Phase: v0.1 - 3. Act safely
- Status: done

## Goal

The first spec that changes a mailbox. The policy engine already says what should happen; this one
applies it, writes down exactly what happened, and makes every bit of it reversible. Nothing here
decides anything.

## Scope

- `packages/core/src/ports`: a decision store, an audit log, and `capabilities()` on the mail
  provider so the executor can tell a read-only mailbox before it tries.
- `packages/core/src/execute`: the executor and undo, over the ports, no I/O of their own.
- `packages/store`: migration `0001`, the decision and action repositories, the audit log.
- `apps/cli`: `run --apply` and `undo --last`, plus what they print.

## Decisions

- **Applying is opt-in, per run.** `run` stays a dry run unless `--apply` is passed. The report is
  unchanged and still ends with what it would do; the flag is the only difference between looking
  and acting.
- **A read-only mailbox is refused before anything is attempted.** The executor asks the provider
  for its capabilities and stops with one sentence naming `init` without `--read-only`. Letting the
  first API call fail instead would put a row in the audit log for something cleamail never had
  permission to do, which is a lie in the one place that has to be exact.
- **No-ops are recorded as skipped, not applied.** The engine plans freely, so a label the message
  already has arrives here as an action. It is dropped from the provider call and counted as
  skipped. An audit log that claims to have starred something already starred cannot be trusted
  about the rest.
- **One decision row per email per run, with its actions as rows beneath it.** The action row holds
  the whole action, including the before-state, because that is what undo reverses from. Undo never
  re-reads the mailbox to guess what the previous state was.
- **The record is written before the mailbox is touched.** Each action goes in as `planned`, the
  provider is called, and the outcome replaces it in the same breath. The obvious order, acting then
  recording, has a hole in it: a write that fails after a successful apply leaves a changed mailbox
  with nothing to undo from, which is the one failure this spec exists to prevent. Writing first
  turns that into the harmless case, because a failed write means nothing has happened yet. If the
  process is killed mid-run, the `planned` rows say what was in flight.
- **The decision and its actions are completed in one transaction.** `completeActions` sets the
  action outcomes and stamps the decision applied together, so a row and its actions can never
  disagree about whether the mailbox changed.
- **"The last run that applied something" is read off the action rows.** Not off a flag on the
  decision: a run whose every action failed did not apply anything, and `undo --last` should skip
  past it to the run that did. A run that has since been undone still counts, which is how a second
  undo finds it and says it was already done.
- **Capabilities are a question for the port, not a Gmail detail in the domain.** `MailProvider`
  gained `capabilities()`, which the Gmail adapter answers from the scopes on the stored token, read
  when it is asked for rather than at construction. A connection that cannot say what it is allowed
  to do counts as read-only, because the safe direction to be wrong in is refusing.
- **A run id groups what one `run --apply` did.** `undo --last` reverses the last run, not the last
  email, because a user who regrets a clean-up regrets the batch. Undoing one email is still
  possible, by id.
- **Undo reverses only what was applied.** Rows that were skipped or that failed are not reversed,
  and a row already reversed is not reversed twice. Undo is idempotent on purpose: running it twice
  must not re-star something the user has since unstarred.
- **An error about one email does not stop the run; an error about the mailbox does.** A message
  that has since been deleted fails for itself and is recorded with its error. An auth failure or an
  unreachable provider fails identically for every email, so the run stops and says so rather than
  writing three hundred identical errors.
- **The audit log holds ids, counts, categories and reasons, never a body.** Every entry is one line
  a user could read out loud. This is the table the dashboard's "Cleaned" list and the undo button
  are built on in SPEC-014.
- **The decision row keeps the review state.** `review_reason` and `review_detail` are columns, and
  the classification columns are nullable, so a decision taken without a classification is a row
  like any other.

## Out of scope

- The opt-in trash rule (SPEC-016). The engine cannot produce a `trash` action yet, but the executor
  and undo handle the type, because the provider already does.
- The dashboard and its undo button (SPEC-014), and the background service (SPEC-015).
- Corrections and embeddings (SPEC-017).

## Acceptance

- `run` without `--apply` changes nothing and still prints what it would do.
- `run --apply` on a read-only mailbox changes nothing, exits non-zero, and names the fix.
- Every applied action has a row holding what it was and what the state was before it.
- A no-op is never sent to the provider and never counted as applied.
- `undo --last` restores every email the last applying run changed, and running it twice changes
  nothing the second time.
- A per-email failure is recorded and the run carries on; a mailbox-level failure stops it.
- No audit entry or log line contains a subject, a sender or a body.

## What building it showed

The schema from SPEC-003 could not store a SPEC-011 decision: `category`, `importance`,
`confidence`, `reason` and `source` were `NOT NULL`, and there were no columns for the review state.
The rows it could not hold were exactly the ones a user most needs to find, the emails the model
could not read. Migration `0001` makes the classification nullable and adds `review_reason`,
`review_detail` and `run_id`.

`drizzle-kit generate` wrote that migration as a table rebuild whose copy step named the new columns
in the `SELECT` from the old table, which fails on any database created by `0000`. It is hand-edited
to copy only the columns `0000` created, with a comment saying so, and the first test run against a
fresh database is what caught it.

Coverage of `packages/core/src/execute` is 100% of statements and functions, and the paths that are
hardest to reach are the ones worth the most: a provider that cannot say what it may do, a store
that fails before the apply, and a store that fails after it.
