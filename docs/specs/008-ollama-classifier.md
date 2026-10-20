# SPEC-008: Ollama classifier, versioned prompts, Zod validation

- Phase: v0.1 - 2. Classify
- Status: done

## Goal

The model half of the pipeline. `packages/llm` turns an email the rules layer did not settle into
one validated `Classification`, using a local Ollama model and nothing else. It has no tools, no
function calling and no say in what happens to the email.

## Scope

- `packages/llm`: the Ollama adapter, implementing the `EmailClassifier` and `ClassificationModel`
  ports from `core`.
- Versioned prompts in `packages/llm/src/prompts/`, one file per version, with a registry so an eval
  run can name the version it measured.
- Zod validation of every model response, plus Ollama's own structured-output `format` so the model
  is constrained before validation rather than only after.
- Prompt rendering that wraps untrusted content in delimiters the email cannot forge, truncates the
  body, and passes the rules layer's hints through.
- `checkOllama` moves here from `apps/cli`, next to the client it belongs to.

## Decisions

- **The model is a config value, not a constant.** `DEFAULT_CLASSIFIER_MODEL` is the documented
  default, and the CLI resolves `CLEAMAIL_MODEL` over it. The default has to be a text-only model
  that `init` can pull for a stranger in five minutes, so a vision-language model is a fine local
  choice but a bad shipped default: it makes every user download an encoder cleamail never calls.
  SPEC-019 picks the default from measured candidates.
- **Content is fenced, and the fence is unforgeable by construction.** The body is wrapped in
  `-----BEGIN UNTRUSTED EMAIL-----` markers, and any line in the content that looks like a marker is
  neutralised before rendering. An email that writes its own end-marker cannot escape the fence and
  continue as if it were the system.
- **Structured output and Zod are both used, and neither is trusted alone.** `format` carries a JSON
  schema so Ollama constrains generation, and the response is still parsed through
  `ModelClassificationSchema`. The schema is generated from the Zod schema, so the two cannot drift.
- **The request body never contains a `tools` key.** A test asserts this on the real body sent to
  `fetch`, because "the classifier has no tools" is a claim worth enforcing rather than documenting.
- **Invalid output is an error, not a guess.** The adapter returns `invalid_model_output`. It does
  not invent a category, and it does not retry with a nudge: a model that returned prose where JSON
  was required has told us nothing about the email. SPEC-011 maps that code to the `cleamail/Review`
  label, which is where the promise in CLAUDE.md is kept.
- **The model may not claim `source` or `model`.** It fills in `ModelClassificationSchema` only, and
  the adapter attaches `source: "model"` and the model name afterwards. Injected text cannot pass
  itself off as a rule match.
- **Temperature 0 and a fixed seed.** Evals are only comparable if the same email and prompt give
  the same answer, and a classifier has no use for creativity.
- **The timeout is 120 seconds, not two.** A measured cold start of an 8B model on this machine took
  58 seconds for the first call and about 1 second warm. A short timeout would turn the first email
  of every run into a failure.
- **`suspicious` is defined narrowly in the prompt.** Measuring the prompt before writing it showed
  an 8B model calling a mortgage receipt `suspicious`, on the grounds that it mentioned money and
  asked the reader to act. Under the policy that is a safe error, since `suspicious` is label-only,
  but it is still a false positive the user would not forgive twice. The prompt now says
  `suspicious` means evidence of forgery, and that a legitimate message asking for action is not
  suspicious.
- **Hints are passed to the model, not re-derived.** `ClassificationRequest` carries the hints the
  rules layer already collected, which is the promise SPEC-007 made.

## Out of scope

- The dry-run report that shows these classifications (SPEC-009) and the eval set that measures them
  (SPEC-010).
- The policy engine that turns a classification into actions, including the mapping from
  `invalid_model_output` to `cleamail/Review` (SPEC-011).
- Few-shot examples from user corrections. `ClassificationRequest.examples` is rendered if present,
  but nothing populates it until SPEC-017.
- Choosing the shipped default model, which needs the benchmark in SPEC-019.

## Safety notes

- The prompt states that everything inside the fence is data, lists the instruction-shaped attacks
  the model should ignore, and repeats the output contract after the content, so the last thing the
  model reads is the real instruction rather than the email's.
- Rules already read headers only. This spec is the first place untrusted free text reaches a
  decision, so the injection tests live here and grow in SPEC-018.
- The only host this package contacts is Ollama on the loopback interface. A test asserts that a
  non-local base URL is refused before any request is made.

## Acceptance

- A recorded well-formed response produces a `Classification` with `source: "model"` and the model
  name attached.
- Prose, a wrong category, an out-of-range score and a missing field each produce
  `invalid_model_output` and no classification.
- An email whose body contains the end-marker, or instructions aimed at the model, does not change
  the structure of the prompt and does not reach the model as an instruction.
- The request body sent to Ollama contains no `tools` or `functions` key.
- A base URL that is not loopback is refused.
- No unit test calls a real model.
