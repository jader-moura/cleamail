# SPEC-003: Store (SQLite + Drizzle)

- Phase: v0.1 - 1. Foundations
- Status: todo

## Goal

`packages/store` persists emails, decisions, actions, the audit log, corrections, embeddings and
settings in a single local SQLite file, and implements the store ports from `core`.

## Scope

- Drizzle schema and generated migrations for `emails`, `decisions`, `actions`, `audit_log`,
  `corrections`, `embeddings`, `settings`.
- A migration runner that runs on open, so the user never types a migrate command.
- Repository implementations of the `core` ports, returning `Result`.
- Database location: the OS app-data directory, overridable with `CLEAMAIL_DB`.
- An in-memory factory for tests.

## Out of scope

- Embedding generation (SPEC-017) and undo logic (SPEC-012). The tables exist; the behavior lands
  later.

## Acceptance

- Opening a fresh file creates the schema; opening an existing one is a no-op.
- Round-trip tests for every repository against an in-memory database.
- No email body is written to any log line.
