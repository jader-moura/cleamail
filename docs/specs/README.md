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
| 009 | Dry-run report in the CLI                                                                | next   |
| 010 | Evals package and eval set v1 (300 synthetic emails)                                     | todo   |

Gate: a dry-run report worth trusting.

## v0.1 - 3. Act safely

| ID  | Spec                                              | Status |
| --- | ------------------------------------------------- | ------ |
| 011 | Policy engine (deterministic, near 100% coverage) | todo   |
| 012 | Actions, audit log, undo                          | todo   |
| 013 | Fastify server on 127.0.0.1 with local API        | todo   |
| 014 | React dashboard: first-run dry-run preview        | todo   |
| 015 | Background scheduler                              | todo   |
| 016 | Opt-in trash rule and settings                    | todo   |

Gate: two weeks on a real inbox, nothing important lost.

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
