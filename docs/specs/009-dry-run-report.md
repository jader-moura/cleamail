# SPEC-009: Dry-run report in the CLI

- Phase: v0.1 - 2. Classify
- Status: done

## Goal

Close the Classify gate: a report the user can read and trust. `cleamail run --dry-run` fetches
recent mail, runs the rules and the model over it, and prints what cleamail thinks and why. Nothing
in the mailbox is touched.

## Scope

- `packages/core/src/pipeline`: the composition of rules and model into one outcome per email. Pure,
  and driven entirely through ports.
- `apps/cli/src/report.ts`: formatting, as pure functions over outcomes. No I/O, so the layout is
  unit tested rather than eyeballed.
- `run --dry-run` wires the two together and prints the report.

## Decisions

- **The rules layer short-circuits the model, and the report says so.** A run that settles 18 of 42
  emails without a model call is both faster and more explainable, and the summary shows the split
  so a user can see how much of the result came from deterministic code.
- **An unclassifiable email is reported, not guessed.** When the model returns something invalid,
  the outcome carries no classification and a `review` reason instead. CLAUDE.md requires the
  fallback to be `cleamail/Review` rather than an action, and inventing a category here to make the
  report tidier would be the first step towards acting on one.
- **A failure to reach the model stops the run; invalid output does not.** If Ollama is down, every
  email will fail for the same reason, and 500 identical errors is not a report. Invalid output is
  per-email and the run continues.
- **Three things route an email to review:** confidence below the threshold, a `suspicious`
  category, and invalid model output. `suspicious` is in that list because the policy forbids
  archiving or trashing it, so a human is the only safe next step.
- **The threshold is 0.6, matching what the prompt tells the model.** A model told that "below 0.6
  means unsure" and a pipeline using a different number would disagree silently.
- **Emails are classified one at a time.** A local model serves one request at a time, so
  concurrency would add queueing and lose the ordered progress output, with nothing gained.
- **The report leads with what needs attention.** Important and needs-reply first with their
  reasons, then review, then the cleanable categories as counts. A user scanning this is looking for
  mistakes in the first group, so it goes where it is read.
- **Every line is derived from a reason the pipeline produced.** No line in the report is written by
  the formatter on its own account, which is what keeps it honest when the classification is wrong.
- **Subjects and sender names are truncated and stripped of control characters** before printing.
  They are attacker-controlled, and a terminal is a renderer like any other.

## Out of scope

- Actions. Nothing is applied, and no action is planned: the policy engine is SPEC-011. The report
  shows categories and reasons, not what will happen to each email.
- The allowlist, blocklist and known senders. The rule context carries only the account address
  until settings arrive in SPEC-016 and corrections in SPEC-017.
- Persisting decisions, which needs the decision store in SPEC-012.
- The eval set that measures whether the report is accurate, which is SPEC-010.

## Acceptance

- `run --dry-run` prints a report with the emails needing attention, their reasons, the review list
  and a summary that accounts for every fetched email.
- A terminal rule match is reported with its rule id and no model call is made for it.
- Invalid model output appears in the review list and the run still completes.
- An unreachable model server fails the run with one message and a non-zero exit code.
- No subject or sender name reaches the terminal with control characters intact.
- The totals in the summary add up to the number of emails classified.
