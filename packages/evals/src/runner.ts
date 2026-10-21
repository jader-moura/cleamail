import {
  DEFAULT_CONFIDENCE_THRESHOLD,
  classifyEmail,
  failure,
  ok,
  type EmailClassifier,
  type Result,
  type RuleContext,
} from "@cleamail/core";
import type { EvalCase } from "./case.js";
import { gradeCase, type GradedCase } from "./grade.js";
import { computeMetrics, type EvalMetrics } from "./metrics.js";
import { EVAL_ACCOUNT_ADDRESS, toEmail } from "./to-email.js";

export type EvalRunOptions = {
  readonly cases: readonly EvalCase[];
  readonly classifier: EmailClassifier;
  /** The run clock. Case ages are relative to it, so the whole run sees one consistent "now". */
  readonly now: Date;
  readonly confidenceThreshold?: number;
  /** Defaults to the eval mailbox with no allowlist, which is what a fresh install has. */
  readonly context?: RuleContext;
  readonly onProgress?: (done: number, total: number) => void;
  /** Monotonic milliseconds, injected so a test can assert on latency without waiting for it. */
  readonly elapsed?: () => number;
};

export type EvalRun = {
  readonly model: string;
  readonly startedAt: Date;
  readonly threshold: number;
  readonly graded: readonly GradedCase[];
  readonly metrics: EvalMetrics;
};

/**
 * Runs the real pipeline over the cases and grades what comes back.
 *
 * This calls `classifyEmail` from `core`, the same function the CLI calls, with the same rules and
 * the same threshold. Nothing about the classification path is reimplemented here: an eval that
 * rebuilds the thing it measures ends up measuring the rebuild.
 *
 * A failure that is not about one email stops the run. An unreachable Ollama fails identically for
 * every case, and a report assembled from 300 copies of one error would be a lie with a percentage
 * attached. Invalid model output is this email's problem, so the pipeline turns it into a review
 * item and the run carries on with it counted as unclassified.
 */
export async function runEval(options: EvalRunOptions): Promise<Result<EvalRun>> {
  const elapsed = options.elapsed ?? (() => performance.now());
  const threshold = options.confidenceThreshold;
  const graded: GradedCase[] = [];

  for (const evalCase of options.cases) {
    const email = toEmail(evalCase, options.now);
    const startedAt = elapsed();

    const outcome = await classifyEmail(email, {
      classifier: options.classifier,
      context: options.context ?? { accountAddress: EVAL_ACCOUNT_ADDRESS },
      ...(threshold === undefined ? {} : { confidenceThreshold: threshold }),
    });

    if (!outcome.ok) {
      return failure(
        outcome.error.code,
        `The run stopped at case ${evalCase.id}: ${outcome.error.message}`,
        outcome.error.cause,
      );
    }

    graded.push(gradeCase(evalCase, outcome.value, elapsed() - startedAt));
    options.onProgress?.(graded.length, options.cases.length);
  }

  return ok({
    model: options.classifier.name,
    startedAt: options.now,
    threshold: threshold ?? DEFAULT_CONFIDENCE_THRESHOLD,
    graded,
    metrics: computeMetrics(graded),
  });
}
