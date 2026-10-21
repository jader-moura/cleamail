import type { Classification } from "../domain/classification.js";
import type { ClassifiableEmail, Email } from "../domain/email.js";
import type { EmailId } from "../domain/ids.js";
import type { ReviewReason } from "../domain/decision.js";
import type { EmailClassifier } from "../ports/classifier.js";
import { classificationFromRule, evaluateRules } from "../rules/evaluate.js";
import type { RuleContext, RuleHint } from "../rules/types.js";
import { err, ok, type Result } from "../result.js";

/**
 * Below this, an email goes to the user instead of being acted on.
 *
 * The prompt tells the model that "below 0.6 means unsure", so the pipeline has to use the same
 * number. A model working to one threshold and a pipeline applying another would disagree without
 * anyone noticing.
 */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.6;

/** One email, classified, with everything the report and the policy engine need to explain it. */
export type ClassificationOutcome = {
  readonly emailId: EmailId;
  /**
   * Absent when the model returned something invalid. Nothing is invented here: an outcome with no
   * classification is routed to `cleamail/Review`, never to an action.
   */
  readonly classification?: Classification;
  readonly hints: readonly RuleHint[];
  /** Set when a human should look at this rather than cleamail acting on it. */
  readonly reviewReason?: ReviewReason;
};

export type ClassifyOptions = {
  readonly classifier: EmailClassifier;
  readonly context: RuleContext;
  readonly confidenceThreshold?: number;
};

/** The subset the classifier is allowed to see. Nothing else is passed on. */
export function toClassifiable(email: Email): ClassifiableEmail {
  return {
    id: email.id,
    from: email.from,
    to: email.to,
    subject: email.subject,
    snippet: email.snippet,
    bodyText: email.bodyText,
    headers: email.headers,
    providerLabels: email.providerLabels,
  };
}

/**
 * Rules first, model second.
 *
 * A terminal rule match ends it: no model is called, which is faster and leaves a decision that can
 * be explained without reference to a model at all. Otherwise the hints the rules gathered go into
 * the request and the model decides.
 *
 * Returns an error only when the problem is not about this email. An unreachable model server will
 * fail identically for every message, so it stops the run; output the model got wrong is this
 * email's problem and becomes a review item.
 */
export async function classifyEmail(
  email: Email,
  options: ClassifyOptions,
): Promise<Result<ClassificationOutcome>> {
  const threshold = options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const outcome = evaluateRules(email, options.context);
  const fromRule = classificationFromRule(outcome);

  if (fromRule !== undefined) {
    return ok(
      withReview({ emailId: email.id, classification: fromRule, hints: outcome.hints }, threshold),
    );
  }

  const classified = await options.classifier.classify({
    email: toClassifiable(email),
    hints: outcome.hints,
  });

  if (!classified.ok) {
    if (classified.error.code !== "invalid_model_output") return classified;

    return ok({
      emailId: email.id,
      hints: outcome.hints,
      reviewReason: "invalid_model_output",
    });
  }

  return ok(
    withReview(
      { emailId: email.id, classification: classified.value, hints: outcome.hints },
      threshold,
    ),
  );
}

/**
 * Decides whether a classified email still needs a human.
 *
 * `suspicious` is here because the policy forbids archiving or trashing it, so there is no safe
 * automatic outcome left: showing it to the user is the action.
 */
function withReview(
  outcome: ClassificationOutcome & { classification: Classification },
  threshold: number,
): ClassificationOutcome {
  const { classification } = outcome;

  if (classification.category === "suspicious") {
    return { ...outcome, reviewReason: "suspicious" };
  }

  if (classification.confidence < threshold) {
    return { ...outcome, reviewReason: "low_confidence" };
  }

  return outcome;
}

export type ClassifyAllOptions = ClassifyOptions & {
  /** Called after each email, for progress output on a run that takes a while. */
  readonly onProgress?: (done: number, total: number) => void;
};

/**
 * Classifies a batch in order.
 *
 * Sequential on purpose: Ollama serves one request at a time, so parallelism would only move the
 * queue and cost the ordered progress the user watches.
 */
export async function classifyEmails(
  emails: readonly Email[],
  options: ClassifyAllOptions,
): Promise<Result<readonly ClassificationOutcome[]>> {
  const outcomes: ClassificationOutcome[] = [];

  for (const email of emails) {
    const outcome = await classifyEmail(email, options);
    if (!outcome.ok) return err(outcome.error);

    outcomes.push(outcome.value);
    options.onProgress?.(outcomes.length, emails.length);
  }

  return ok(outcomes);
}
