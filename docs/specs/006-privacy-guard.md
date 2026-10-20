# SPEC-006: Privacy guard (outbound host allowlist)

- Phase: v0.1 - 1. Foundations
- Status: done

## Goal

A test that fails if any code path makes an outbound request to a host other than the user's mail
provider or localhost. This is how the "private" promise stays true as the codebase grows.

## Scope

- A harness that patches `fetch`, the `http` and `https` request functions and the DNS lookup,
  asserting every target host is on the allowlist: `localhost`, `127.0.0.1`, `::1`,
  `gmail.googleapis.com`, `oauth2.googleapis.com`, `accounts.google.com`, and the configured IMAP
  host.
- A run of the real pipeline with a canned responder in place of the network.
- A static check over the built web bundle: no external script, font or stylesheet URLs.

## Decisions

- **It is a package, `@cleamail/privacy`, not a test file.** Other packages install the guard in
  their own tests, which is how it keeps working as the codebase grows: `apps/cli` already uses it
  to assert that a whole fetch-and-store run makes no outbound call at all, and `packages/llm` will
  use it in SPEC-008.
- **Three layers, because each catches what the others miss.**
  1. The runtime guard proves what the code does: it runs the real `GmailRestApi`, the real OAuth
     exchange and the real token refresh, records every host and answers from a canned responder.
     Every recorded host is Gmail's, and the suite includes a deliberate violation so the guard is
     proven to fail when it should.
  2. The source scan proves no new host has appeared anywhere in the repository, including in HTML
     and CSS, which is where a CDN script or a Google Font would hide. A host that is neither
     contacted nor documented fails the test, so adding one is a decision somebody has to make out
     loud.
  3. The HTML scan is ready for `apps/web` in SPEC-014 and is covered by its own tests now, so the
     check is proven before there is a bundle to point it at.
- **An allowed host still does not open a connection.** Under the guard, an allowed host without a
  canned response raises `LiveConnectionError` rather than going out, so a test can never silently
  depend on the network.
- **Two lists, not one.** `NETWORK_ALLOWED_HOSTS` is what may be contacted; `MENTION_ONLY_HOSTS` is
  what may appear as text (ollama.com in a help message, the OAuth scope identifier, the setup
  links). Conflating them would either forbid useful links or quietly permit a real call.
- **Tests and fixtures are excluded from the source scan**, and a flag includes them. They are where
  the counter-examples live: a test proving a CDN is blocked has to name that CDN, and an eval
  fixture is a synthetic email that may contain links. Neither ships, and the runtime guard covers
  behaviour.
- **The scan guards itself**: one test asserts it still walks a meaningful number of files, so a
  broken walk cannot make the allowlist test pass for free.
- `net` and `tls` are not patched yet. They matter for IMAP, and patching them while nothing uses
  them would risk interfering with the test runner for no gain. SPEC-021 adds them with the IMAP
  adapter.

## Acceptance

- Adding an outbound call to any other host anywhere in the pipeline fails the suite, and a test
  proves exactly that by making one.
- The real Gmail client, OAuth exchange and token refresh reach only `gmail.googleapis.com` and
  `oauth2.googleapis.com`.
- A full `cleamail run` with a fake provider records zero outbound attempts.
- 22 tests here, plus 2 in `apps/cli`.
