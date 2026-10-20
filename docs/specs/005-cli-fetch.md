# SPEC-005: CLI skeleton and fetch into SQLite

- Phase: v0.1 - 1. Foundations
- Status: done

## Goal

`apps/cli` exposes the `cleamail` command and can connect an account and pull the last 7 days of
mail into SQLite. This is the Foundations gate.

## Scope

- The command surface with help text: `init`, `run`, `start`, `eval`, `undo`, `status`, `logout`
  (`logout` deletes the stored credential, which `docs/gmail-setup.md` points users to). Only the
  parts Foundations needs do real work; the rest exit with a clear "not in this phase yet" message
  naming the spec that adds them.
- `cleamail init`: checks that Ollama is reachable, connects the mail account, stores the account.
- `cleamail run --dry-run --since 7d`: fetches and stores, prints counts only, no classification.
- `cleamail status`: account, database path, message counts, last sync, Ollama.
- Structured logging with message ids and counts, never bodies.

## Decisions

- **`node:util`'s `parseArgs`, not a CLI framework.** Seven commands and three flags do not justify
  a dependency, and `parseArgs` already rejects unknown flags, which keeps a typo from silently
  becoming a different run.
- **One `CliDeps` object is the composition root.** Commands receive the store, the token store, the
  secret store, provider factories, `prompt`, `openUrl`, the OAuth pieces and the Ollama check. No
  command reaches for a global, so every command, `init` included, is tested against the in-memory
  store and the fake provider, with no mailbox and no keychain.
- **`init` writes nothing until Google has said yes**, and refuses a grant that came back with a
  scope cleamail must not hold, storing nothing. The account id is the mailbox address, so the
  profile is read with the fresh token before that token is filed under the id.
- **A missing Ollama is a warning, not a blocker.** Nothing is classified in this phase, so making
  it fatal would stop someone connecting their mailbox for no reason.
- **`run` always behaves as a dry run here.** `--dry-run` is accepted and ignored, because there is
  no classifier and no policy engine yet, and the summary says so in as many words.
- **Exit codes:** 0 worked, 1 something failed, 2 the command line was wrong. A window that cannot
  be parsed is a usage error, and the mailbox is never contacted.
- **`cleamail logout` leaves the database alone**, and says so. Deleting the user's own data should
  be a separate, explicit act.
- The Ollama check lives in the CLI for now and moves to `packages/llm` in SPEC-008, when there is a
  classifier to go with it.
- `pnpm dev` for the CLI is `tsc && node dist/main.js`: Node 22's type stripping cannot resolve the
  `.js` specifiers NodeNext requires, and a loader dependency is not worth one script. The CLI also
  tolerates the `--` that pnpm forwards.

## Out of scope

- Classification, policy, actions and undo. `run` fetches and stores, nothing else.
- The polished `init` wizard, which is SPEC-020.

## Acceptance

- `cleamail --help`, `status`, `run` and an unknown command behave correctly against the real built
  binary, with the right exit codes (checked by hand as well as in tests).
- Two consecutive runs store no duplicates: the second reports `updated` and the count stays put.
- `--since` accepts `7d`, `24h` and an ISO date, and refuses anything else.
- 38 tests, including the whole `init` flow and the refusal of an over-wide grant.
