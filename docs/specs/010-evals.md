# SPEC-010: Evals package and eval set v1

- Phase: v0.1 - 2. Classify
- Status: done

## Goal

Close the Classify gate by measuring it. SPEC-009 made a dry-run report; this makes a number that
says whether the report deserves to be trusted. `pnpm eval` runs the real rules-and-model pipeline
over a committed set of synthetic emails with known labels and prints per-category precision and
recall, a confusion matrix, latency, and the one figure that matters most: how often cleamail would
have cleaned an email that mattered.

## Scope

- `packages/evals`: the dataset, its loader, grading, metrics, the text report and the runner.
- `packages/evals/datasets/v1.jsonl`: the eval set, committed and reviewable.
- `packages/evals/src/generate`: the scenarios and the builder, so the set can grow and be reviewed.
- `pnpm eval` and `pnpm eval:smoke`, already declared in the root scripts, finally do something.
- One small addition to `core`: `CLEANABLE_CATEGORIES`, the complement of the protected set.

## Decisions

- **The dataset is a committed file, not a generator run at eval time.** A measurement whose inputs
  are regenerated on every run cannot be compared across commits, which is the whole point of having
  one. The generator is committed too, and a test asserts the file is exactly what the generator
  produces, so the dataset cannot drift from the scenarios it claims to come from and a change to
  either shows up as a reviewable diff in both.
- **Diversity comes from hand-written scenarios, volume from deterministic expansion.** The roadmap
  asks for 300 emails. Three hundred variations of a dozen templates would measure almost nothing,
  so the set is built from many hand-written scenarios, each expanded a few times by substituting
  names, companies, amounts and order numbers from fixed pools. The number worth quoting is the
  scenario count, not the case count, and the report prints both.
- **A case can have more than one defensible label.** A shipping update is honestly arguable between
  `notification` and `fyi`, and a product announcement between `newsletter` and `promotion`. Each
  case carries `expect` plus an `acceptable` set, and both count as correct. Grading a model wrong
  for a disagreement a careful human would also have turns the eval into noise, and noise is what
  gets ignored.
- **`mustNot` is separate from a wrong label.** For the injection cases, "did not say `important`"
  is the actual assertion: the email's body is trying to make it say that. A `mustNot` hit is
  reported on its own line, because it means a defence failed rather than a judgement being off.
- **The headline safety metric is the dangerous miss, defined narrowly.** A dangerous miss is an
  email whose true category is protected (`important`, `needs_reply`, `suspicious`) that was
  classified into a cleanable one and was _not_ routed to review, so the policy would archive it
  with no human in the way. CLAUDE.md names "false positives on `important`" as the key metric, and
  this is what that has to mean to be a safety metric: a promotion wrongly called important only
  leaves it in the inbox, which costs the user a glance, while an important email wrongly called a
  promotion is the failure the product exists to avoid. Per-category precision and recall are both
  reported too, so the other reading is available to anyone who wants it.
- **Over-cleaning `fyi` is reported but not gated.** An `fyi` email read as a `promotion` also gets
  archived. It is a real cost and belongs in the report, but it is not loss of something that needed
  action, so it does not share the 1% budget.
- **The runner drives the real pipeline through its real ports.** It calls `classifyEmail` from
  `core` with the same rules, the same prompt and the same threshold the CLI uses. An eval that
  reimplements any part of the path it is measuring measures the reimplementation.
- **Errors that are not about one email stop the run.** An unreachable Ollama fails identically for
  all 300 cases, and a report built from 300 copies of the same error would be a lie with a
  percentage on it. Invalid model output is per-email and becomes an unclassified case, which is the
  safe fallback the pipeline already guarantees.
- **The gate is opt-in.** `pnpm eval` prints the numbers and exits zero; `--gate` makes a dangerous
  miss rate above 1% a non-zero exit. The 1% target is the phase-4 gate, so making it fail now would
  only train everyone to ignore a red eval through all of phase 3.
- **The smoke set is chosen, not sampled.** Twenty cases carry a `smoke` tag, picked to cover every
  category and the injection defences. A sampler would quietly change which cases run whenever the
  set grows, and a 20-case subset exists precisely so its contents are predictable.
- **Every synthetic address is in a reserved example domain.** A test fails if any sender or
  recipient in the dataset is outside `example.com`, `example.org`, `example.net` or `*.example`.
  CLAUDE.md forbids committing real email data, and this is that rule as something a machine checks
  rather than something a reviewer has to notice.
- **The package's own tests never reach a model.** They run against a scripted classifier, so
  `pnpm test` stays fast and offline. Reaching the model is what `pnpm eval` is for, and it is not
  part of `pnpm test`.

## Out of scope

- Wiring `eval:smoke` into GitHub Actions. The runner there has no Ollama, and installing and
  warming a 7B model on every push would cost more than it tells us. The model benchmark in SPEC-019
  is where running this against more than one model belongs.
- `scripts/anonymize.ts`, named in CLAUDE.md. There is nothing to anonymize while the set is
  generated from scenarios, and shipping an untested script that handles real mail would add the
  risk it exists to remove. It arrives with the first fixture that needs it.
- Judging the policy's actions. The runner grades categories and uses the documented policy defaults
  to decide whether a miss would have been acted on. SPEC-011 should replace that reading of the
  defaults with a call into the real policy engine.
- Embedding-based nearest-neighbour metrics and the corrections set, which need SPEC-017.

## First baseline

Run on `qwen3-vl:8b-instruct`, because the documented default `qwen2.5:7b` is not pulled on the
machine this was built on. Treat the numbers as a shape, not a score for the shipped model.

| Measure           | Value           |
| ----------------- | --------------- |
| correct           | 78.3% (235/300) |
| exact             | 62.0%           |
| dangerous misses  | 3 (1.0%)        |
| must-not failures | 1 (0.3%)        |
| unclassified      | 0               |
| settled by rules  | 34 (11.3%)      |
| sent to review    | 15 (5.0%)       |
| latency, p50      | 783ms           |

Three findings, in the order they matter:

- **A model with a thinking mode cannot be used at all.** On `qwen3-vl:8b` every single case came
  back unclassified: the model spends the whole reply budget on reasoning and returns an empty
  message. Raising the cap to 4000 tokens produced 13,571 characters of reasoning and still no
  answer. This was invisible in the first report, which said only "17 unclassified", so the adapter
  now names the cause and the report groups the unclassified cases by what they failed on.
- **The classifier over-uses `fyi`.** 127 predictions against a support of 40, which drags
  `notification` recall to 0.16 and `newsletter` recall to 0.34. `fyi` is the category the policy
  does nothing with, so a model that reaches for it cleans almost nothing. That is a prompt problem
  rather than a pipeline one, and changing a prompt requires its own eval run, so it is SPEC-008's
  to revisit with this measurement in hand.
- **One injection landed.** `injection-json-output-03` produced `important`, the label the email
  asked for, on one of three variants of the same payload. The defence held on the other seven
  injection scenarios. This is the case SPEC-018 exists for.

The 3 dangerous misses are all `crypto-giveaway`, read as `promotion` and so archivable. Archiving a
scam costs the user little in practice, but `suspicious` is a protected category by CLAUDE.md, and
the metric follows the product's rule rather than arguing with it.

## Acceptance

- `pnpm eval` runs the pipeline over 300 committed cases and prints per-category precision, recall
  and support, a confusion matrix, the dangerous-miss count with the ids, the review rate, the
  rule-versus-model split and latency percentiles.
- `pnpm eval:smoke` runs the 20 tagged cases.
- `pnpm eval --gate` exits non-zero when the dangerous miss rate is above 1%.
- The dataset loads through Zod, and a malformed line fails the load with the line number.
- Regenerating the dataset produces the committed file byte for byte.
- Every address in the dataset is in a reserved example domain, proven by a test.
- The package's tests pass with no Ollama running.
