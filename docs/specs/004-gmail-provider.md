# SPEC-004: Gmail provider and OAuth with keychain tokens

- Phase: v0.1 - 1. Foundations
- Status: todo

## Goal

`packages/providers` ships a Gmail adapter implementing the `MailProvider` port, with a local OAuth
flow whose tokens live in the OS keychain.

## Scope

- OAuth: loopback redirect on `127.0.0.1`, scope `gmail.modify` at most, refresh handled inside the
  adapter. Never request `gmail.send`.
- Token storage behind the `TokenStore` port, with a keychain implementation (keytar or equivalent).
- `listMessages({ since, maxResults })` and `getMessage(id)` mapped to the domain `Email`: header
  normalization, HTML stripped to text, Gmail category labels preserved.
- Rate-limit and 429 handling with backoff.
- A contract test suite that this adapter and the SPEC-021 IMAP adapter both must pass, plus a fake
  provider for every other package to test against.

## Out of scope

- Applying actions. SPEC-012 wires it; the port method may land here returning a clear "not
  implemented in this phase" error.

## Safety notes

- Scopes and token storage are security-critical. Any change here is called out in the PR summary.

## Acceptance

- Contract tests pass against the fake and, manually, against one real account.
- No token value ever appears in a log line.
