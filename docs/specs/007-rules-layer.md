# SPEC-007: Rules layer

- Phase: v0.1 - 2. Classify
- Status: done

## Goal

Deterministic rules run before the model. A confident match classifies the email outright and skips
the model; everything else collects hints that the classifier can use, and the model decides.

## Scope

- `packages/core/src/rules`: pure functions over a `ClassifiableEmail`, no I/O, no dependencies.
- Signals: authentication failures and display-name spoofing, the user's allowlist and blocklist,
  senders the user has corrected before, Gmail's own category labels, and bulk-mail headers
  (`List-Unsubscribe`, `List-Id`, `Precedence`).
- A `RuleOutcome`: either a `Classification` with `source: "rule"` and the `ruleId`, or no
  classification plus the hints gathered on the way.
- Hints are structured and named, so they can be put in a prompt in SPEC-008 and shown in the
  dashboard in SPEC-014.

## Decisions

- **Order is a safety decision, not an implementation detail.** Suspicion is checked before the
  allowlist, because spoofing a trusted sender is the oldest trick there is: an allowlisted display
  name must not launder a failed DMARC check. Then allowlist, then blocklist, then the user's own
  corrections, then Gmail's categories, then bulk headers.
- **Only strong signals are terminal.** A terminal match skips the model, so the bar is "Google or
  the user already told us". `CATEGORY_PROMOTIONS`, `CATEGORY_SOCIAL`, an explicit allowlist or
  blocklist entry, a past correction for that sender, a hard DMARC failure, and the bulk-mail
  combination all qualify.
- **`List-Unsubscribe` on its own is a hint, not a verdict.** Password resets, receipts and order
  confirmations carry it too, and archiving those would be exactly the kind of false positive the
  first promise forbids. It becomes terminal only together with `List-Id` or `Precedence: bulk`.
- **`CATEGORY_UPDATES` and `CATEGORY_FORUMS` are hints, not verdicts.** Receipts, invoices and
  genuine threads live there.
- **An allowlisted sender is classified `important`.** The user said this sender matters, so the
  policy engine stars it and keeps it in the inbox. A softer "protected but uncategorised" state
  would need a concept the policy engine does not have in v0.1.
- **Rules read headers, labels and addresses only, never the body.** Nothing a sender writes in a
  message can change a rule's outcome, which is one less place for injected text to reach a
  decision. A test asserts this.
- **Every match carries its `ruleId` and a one-sentence reason**, so the dashboard can always answer
  "why did this happen" without the model being involved.

## Out of scope

- The model classifier and the prompt (SPEC-008), the dry-run report (SPEC-009), and the policy
  engine that turns a classification into actions (SPEC-011).
- Populating known senders from corrections, which arrives with embeddings in SPEC-017. The rule
  reads whatever the context provides and does nothing when that is empty.

## Acceptance

- A confident rule match returns a valid `Classification` with `source: "rule"` and a `ruleId`.
- No rule outcome changes when only the body changes.
- Transactional mail carrying `List-Unsubscribe` is not classified as a newsletter.
- A spoofed display name over an allowlisted address is `suspicious`, not `important`.
- Unit tests cover every rule, the ordering between them, and the hint collection.
