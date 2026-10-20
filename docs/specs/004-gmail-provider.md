# SPEC-004: Gmail provider and OAuth with keychain tokens

- Phase: v0.1 - 1. Foundations
- Status: done

## Goal

`packages/providers` ships a Gmail adapter implementing the `MailProvider` port, with a local OAuth
flow whose tokens live in the OS keychain.

## Scope

- OAuth: loopback redirect on `127.0.0.1`, scope `gmail.modify` at most, refresh handled inside the
  adapter. Never request `gmail.send`.
- Token storage behind the `TokenStore` port, with a keychain implementation.
- `listEmails({ since, maxResults })` and `getEmail(id)` mapped to the domain `Email`: header
  normalization, HTML stripped to text, Gmail category labels preserved.
- Rate-limit and 429 handling with backoff.
- A contract test suite that this adapter and the SPEC-021 IMAP adapter both must pass, plus a fake
  provider for every other package to test against.

## Decisions

- **A hand-written REST client over six endpoints, not `googleapis`.** This differs from the note in
  CLAUDE.md. `googleapis` pulls in a very large dependency tree for `profile`, `messages.list`,
  `messages.get`, `messages.modify`, `trash`/`untrash` and `labels`, which works against the
  five-minute `npx cleamail` install, and it makes the privacy guard in SPEC-006 harder to state:
  with this client every outbound request is in one file and every host is in `src/hosts.ts`.
  Responses are validated with Zod before the mapper sees them. If this turns out to be the wrong
  call, `GmailRestApi` is the only file that changes, because the provider talks to the narrow
  `GmailApi` port instead.
- **The `GmailApi` port is deliberately tiny.** No send, no draft and no permanent-delete method
  exists on it, so no future refactor can reach for one, and the adapter's own logic is testable
  without a network. `StubGmailApi` behaves like Gmail where it matters: user labels are opaque ids,
  state lives in label ids, and trashing swaps `INBOX` for `TRASH`.
- **Label ids are resolved to names.** Gmail returns `Label_7`; the domain carries
  `cleamail/Cleaned`. The adapter keeps both directions of the map, with one `labels.list` per
  process, so the rules layer and the dashboard deal in names. System labels such as
  `CATEGORY_PROMOTIONS` are their own name and pass through.
- **PKCE with a loopback listener, no hosted callback.** The code verifier never leaves the process,
  `state` is compared in constant time, the listener binds `127.0.0.1` only and answers exactly one
  request, and it times out rather than waiting forever. The user supplies their own Google OAuth
  client id (see [gmail-setup.md](../gmail-setup.md)): shipping one in a public repo would mean a
  shared quota and would tie every install to a single project.
- **A message that cannot be mapped is skipped, not guessed at.** No date or no sender yields
  `invalid_provider_data`, the run logs a count, and that message gets no decision and no action: it
  stays exactly where it is. "Never lose what matters" beats "classify everything".
- **Actions collapse into one `modify` call**, so the mailbox does not pass through intermediate
  states, and `reverseActions` uses the before-state each action carries instead of recomputing it.
- **A response cleamail cannot parse is not retried** (422, not 5xx). 429 and 5xx are retried with
  exponential backoff.
- `@napi-rs/keyring` for the keychain rather than `keytar`, which is archived. It ships prebuilt
  binaries and is maintained. The entry is injected through a factory, so the keychain logic is unit
  tested without a desktop session.

## Safety notes

- The scope list and the forbidden-scope list are asserted in tests: `gmail.modify` only, never
  `gmail.send`, `gmail.compose`, `gmail.settings.basic` or `mail.google.com`.
- `hasOnlyAllowedScopes` rejects a grant that comes back wider than what was asked for.
- No token value appears in any error message or log line; failures say "reconnect" and stop there.
- The only hosts reachable from this package are `accounts.google.com`, `oauth2.googleapis.com` and
  `gmail.googleapis.com`, listed in `src/hosts.ts` for SPEC-006 to assert on.

## Out of scope

- Wiring the adapter into a command: that is SPEC-005.
- Live verification against a real mailbox. Everything here is covered offline by the contract suite
  and the stub; the first real-account run happens in SPEC-005, once `cleamail init` exists.

## Acceptance

- The Gmail adapter and the fake both pass the same 11-case `MailProvider` contract.
- 108 tests cover MIME decoding, address parsing, mapping, label resolution, OAuth, token storage
  and retry behaviour.
- Reversing a set of actions restores labels, inbox state, read state and trash state exactly.
