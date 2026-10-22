# Specs

Small, reviewable units of work for cleamail. Each spec is one or two commits, ends green on
`pnpm lint && pnpm typecheck && pnpm test`, and does not cross into the next phase.

Status: `todo` | `in progress` | `done`

## v0.1 - 1. Foundations

| ID  | Spec                                                                   | Status |
| --- | ---------------------------------------------------------------------- | ------ |
| 001 | [Monorepo and tooling baseline](001-monorepo-tooling.md)               | done   |
| 002 | [Core domain model and ports](002-core-domain.md)                      | done   |
| 003 | [Store: SQLite + Drizzle schema](003-store-sqlite.md)                  | done   |
| 004 | [Gmail provider and OAuth with keychain tokens](004-gmail-provider.md) | done   |
| 005 | [CLI skeleton and `fetch` into SQLite](005-cli-fetch.md)               | done   |
| 006 | [Privacy guard: outbound host allowlist test](006-privacy-guard.md)    | done   |

Gate: reads the inbox reliably. Code complete; the gate also wants one run against a real mailbox,
which needs a Google OAuth client (see [gmail-setup.md](../gmail-setup.md)).

## v0.1 - 2. Classify

| ID  | Spec                                                                                     | Status |
| --- | ---------------------------------------------------------------------------------------- | ------ |
| 007 | [Rules layer](007-rules-layer.md)                                                        | done   |
| 008 | [Ollama classifier adapter, versioned prompts, Zod validation](008-ollama-classifier.md) | done   |
| 009 | [Dry-run report in the CLI](009-dry-run-report.md)                                       | done   |
| 010 | [Evals package and eval set v1](010-evals.md)                                            | done   |

Gate: a dry-run report worth trusting. Code complete, and now measurable: `pnpm eval` reports
accuracy, per-category precision and recall, and the dangerous-miss rate against 300 synthetic
emails.

Settled by SPEC-011: the eval runner used to decide whether a miss would have been acted on by
reading `CLEANABLE_CATEGORIES` and the review flag, which was the documented policy default standing
in for the policy itself. It now asks the engine, so the safety metric and the product cannot
disagree about what would have happened to an email.

## v0.1 - 3. Act safely

| ID  | Spec                                                  | Status |
| --- | ----------------------------------------------------- | ------ |
| 011 | [Policy engine](011-policy-engine.md)                 | done   |
| 012 | [Actions, audit log, undo](012-actions-audit-undo.md) | done   |
| 013 | Fastify server on 127.0.0.1 with local API            | next   |
| 014 | React dashboard: first-run dry-run preview            | todo   |
| 015 | Background scheduler                                  | todo   |
| 016 | Opt-in trash rule and settings                        | todo   |

Gate: two weeks on a real inbox, nothing important lost.

Settled by SPEC-012: the executor skips no-ops, records what actually changed, and asks the provider
for its capabilities before attempting anything, so a read-only mailbox is refused in words rather
than failing at the API. The record is written before the mailbox is touched, which is what makes
`cleamail undo` able to promise it can reverse everything that happened.

Carried into SPEC-013 from SPEC-012: the local API serves the decisions, the audit log and the undo
button from the same store the CLI writes to, and `run --apply` is the only path that changes a
mailbox. Nothing in the server may plan actions of its own.

Carried into this phase from SPEC-008: a mailbox connected with `cleamail init --read-only` holds a
`gmail.readonly` token, so Google refuses any change. Every spec here that applies an action must
check `canModify` on the stored token first and tell the user to re-run `init` without the flag,
rather than letting the attempt fail at the API and land in the audit log as an error. Read-only is
a supported way to run cleamail, not just a way to try it, so "it cannot act" has to be a sentence
the product says rather than a stack trace.

## v0.1 - 4. Learn and measure

| ID  | Spec                                                  | Status |
| --- | ----------------------------------------------------- | ------ |
| 017 | Corrections as few-shot examples via local embeddings | todo   |
| 018 | Prompt-injection test suite                           | todo   |
| 019 | Model benchmark runner                                | todo   |

Gate: under 1% false positives on `important`.

## v0.1 - 5. Launch

| ID  | Spec                                         | Status |
| --- | -------------------------------------------- | ------ |
| 020 | `cleamail init` wizard                       | todo   |
| 021 | IMAP fallback provider                       | todo   |
| 022 | MCP server (read-only queries, safe actions) | todo   |
| 023 | Docs site, demo GIF, npm + Docker release    | todo   |

Gate: a stranger installs it in 5 minutes.
