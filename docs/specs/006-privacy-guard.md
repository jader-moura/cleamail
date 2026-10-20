# SPEC-006: Privacy guard (outbound host allowlist)

- Phase: v0.1 - 1. Foundations
- Status: todo

## Goal

A test that fails if any code path makes an outbound request to a host other than the user's mail
provider or localhost. This is how the "private" promise stays true as the codebase grows.

## Scope

- A harness that patches `fetch`, the `http` and `https` request functions, and the DNS lookup the
  mail libraries use, asserting every target host is on the allowlist: `localhost`, `127.0.0.1`,
  `gmail.googleapis.com`, `oauth2.googleapis.com`, `accounts.google.com`, and the configured IMAP
  host.
- A run of the real pipeline over fixtures with the fake provider and a recorded Ollama response.
- A static check over the built web bundle: no external script, font or stylesheet URLs.

## Acceptance

- Adding an outbound call to any other host anywhere in the pipeline fails the suite.
- Documented alongside the privacy claims in the README.
