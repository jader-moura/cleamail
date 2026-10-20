# SPEC-005: CLI skeleton and fetch into SQLite

- Phase: v0.1 - 1. Foundations
- Status: todo

## Goal

`apps/cli` exposes the `cleamail` command and can connect an account and pull the last 7 days of
mail into SQLite. This is the Foundations gate.

## Scope

- The command surface with help text: `init`, `run`, `start`, `eval`, `undo`, `status`, `logout`
  (`logout` deletes the stored credential, which `docs/gmail-setup.md` points users to). Only the
  parts Foundations needs do real work; the rest exit with a clear "not in this phase yet" message.
- `cleamail init`: checks that Ollama is reachable, connects the mail account, writes settings.
- `cleamail run --dry-run --since 7d`: fetches and stores, prints counts only, no classification.
- `cleamail status`: account, database path, message counts, last sync.
- Structured logging with message ids and counts, never bodies.

## Acceptance

- On a connected account, two consecutive runs store no duplicates.
- `--since` accepts `7d`, `24h` and an ISO date.
