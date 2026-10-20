# SPEC-002: Core domain model and ports

- Phase: v0.1 - 1. Foundations
- Status: done

## Goal

`packages/core` holds the domain: the fixed category set, the `Email`, `Classification`, `Decision`
and `Action` shapes as Zod schemas, a typed `Result`, and the ports every adapter implements. No
I/O, no dependency on any other package in the repo.

## Scope

- Categories (fixed in v0.1): `important`, `needs_reply`, `fyi`, `newsletter`, `promotion`,
  `notification`, `suspicious`.
- `Email`: a provider-neutral message. Addresses, subject, snippet, body text, headers as a
  lowercase-keyed record, provider labels, flags (read, starred), dates, size.
- `Classification`: exactly the shape in CLAUDE.md, with `importance` and `confidence` in `0..1`, a
  one-sentence `reason`, and `source` of `rule` or `model`.
- `Action`: `label`, `star`, `archive`, `mark_read`, `trash`, each carrying what is needed to
  reverse it.
- `Decision`: an email id plus its classification plus the planned actions, so the policy engine in
  SPEC-011 has a target type to produce and the audit log a shape to store.
- `Result<T, E>`: `ok` / `err` helpers, used instead of throwing inside domain code.
- Ports: `MailProvider` (fetch and apply, nothing else), `EmailClassifier`, the `EmailStore` surface
  Foundations needs, `TokenStore`, and `Clock`.
- Reserved label names (`cleamail/Cleaned`, `cleamail/Review`) live here as constants, because the
  policy engine and the providers need the same strings.

## Out of scope

- The policy engine itself (SPEC-011), the rules layer (SPEC-007), prompts (SPEC-008). Ports only,
  so adapters can be built against them in parallel.

## Decisions

- Zod is the source of truth; every exported type is `z.infer` of a schema. Branded `EmailId` and
  `ThreadId` so provider ids cannot be swapped by accident.
- The email body is `bodyText` only. No HTML in the domain: providers strip it, which keeps prompt
  input small and avoids carrying markup into the model or the store.
- `headers` is a `Record<string, string>` with lowercase keys and joined values, which is what the
  rules layer needs for `List-Unsubscribe` without knowing about Gmail or IMAP shapes.
- Ports return `Result` and never throw, so apps have exactly one error path.
- `Action` is a discriminated union on `type`, and each variant carries its own reversal data, so
  undo in SPEC-012 cannot be written without the data it needs.

## Acceptance

- Schemas reject out-of-range `importance` and `confidence`, unknown categories, and empty reasons.
- `packages/core` has zero repo-internal dependencies and performs no I/O.
- Unit tests cover schema edges, branded ids, `Result` helpers and header normalization.
