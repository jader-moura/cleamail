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
  blocklist entry, a past correction for that sender, a hard DMARC failure and a display-name spoof
  qualify. Gmail's categories are on that list because Google classified them with access to the
  content; a header pattern is not, as the bulk-mail decision below records.
- **Bulk-mail headers are a hint, not a verdict.** Password resets, receipts and order confirmations
  carry `List-Unsubscribe` too, and archiving those would be exactly the kind of false positive the
  first promise forbids.

  This spec originally treated `List-Unsubscribe` plus `List-Id` or `Precedence: bulk` as strong
  enough to be terminal. Measuring the pipeline in SPEC-009 disproved it: a shop receipt carrying
  `List-Id: receipts.store.example` was classified `newsletter` with the model never consulted.
  Transactional senders run their receipts through mailing-list infrastructure like everything else,
  so the headers do not separate a receipt from a digest.

  No rule can repair this, because `RuleInput` deliberately withholds the subject and body. The
  headers are now hints only (`has_unsubscribe_link`, `bulk_headers`) and the model, which can read
  the subject, decides. The cost is a model call for every bulk message; the alternative was
  archiving receipts, which the first promise does not allow.

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
- Transactional mail carrying bulk-mail headers is not settled by a rule at all, whether it carries
  `List-Unsubscribe` alone or together with `List-Id` and `Precedence`.
- A spoofed display name over an allowlisted address is `suspicious`, not `important`.
- Unit tests cover every rule, the ordering between them, and the hint collection.
