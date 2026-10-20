# SPEC-003: Store (SQLite + Drizzle)

- Phase: v0.1 - 1. Foundations
- Status: done

## Goal

`packages/store` persists emails, decisions, actions, the audit log, corrections, embeddings and
settings in a single local SQLite file, and implements the store ports from `core`.

## Scope

- Drizzle schema and generated migrations for `emails`, `decisions`, `actions`, `audit_log`,
  `corrections`, `embeddings`, `settings`, plus `accounts` (added: `lastSyncAt` and the per-account
  scoping of every other table need a row to hang off).
- A migration runner that runs on open, so the user never types a migrate command.
- Repository implementations of the `core` ports, returning `Result`.
- Database location: the OS app-data directory, overridable with `CLEAMAIL_DB`.
- An in-memory factory for tests.

## Out of scope

- Embedding generation (SPEC-017) and undo logic (SPEC-012). The tables exist; the behavior lands
  later. Only the `EmailStore` port gets a repository here, alongside accounts and settings, which
  the CLI needs in SPEC-005.

## Decisions

- `better-sqlite3` with Drizzle rather than `node:sqlite`: the built-in module is still experimental
  on Node 22, and `better-sqlite3` ships prebuilt binaries, so `npx cleamail` does not need a
  compiler on the user's machine.
- Rows are validated with the domain schemas on the way out. The database is external input: it may
  predate a migration or have been hand-edited, so a bad row becomes a typed `store_failure` instead
  of a malformed `Email` reaching the classifier.
- JSON columns are stored as text and parsed in the mapper rather than relying on driver JSON
  typing, which keeps validation in one place.
- `firstSeenAt` is written once and never updated. It is what the trash rule counts days from, so an
  overlapping re-fetch must not reset the clock on an email.
- Saving is an upsert keyed on the provider message id, in one transaction, reporting inserted and
  updated counts so a run can show what it actually did.
- `PRAGMA foreign_keys = ON` (SQLite defaults to off) and WAL, so the background service and the
  dashboard do not block each other.
- Settings reads take the caller's Zod schema, so an out-of-range threshold written by an older
  version cannot reach the policy engine.

## Acceptance

- Opening a fresh file creates the directory and the schema; reopening keeps the data. Covered by
  `src/store.test.ts`.
- Round-trip tests for every repository against an in-memory database (28 tests).
- No email body is written to any log line: the store does not log at all.
