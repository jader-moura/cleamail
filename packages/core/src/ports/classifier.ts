import type {
  Classification,
  ClassificationExample,
  ModelClassification,
} from "../domain/classification.js";
import type { ClassifiableEmail } from "../domain/email.js";
import type { Result } from "../result.js";

export type ClassificationRequest = {
  readonly email: ClassifiableEmail;
  /** Past user corrections, used as few-shot examples. */
  readonly examples?: readonly ClassificationExample[];
};

/**
 * A classifier returns one validated classification and nothing else. No tools, no function
 * calling, no action choice: that is what keeps untrusted email content from reaching the inbox as
 * an instruction.
 *
 * Invalid output is an error (`invalid_model_output`), and the caller routes the email to
 * `cleamail/Review` rather than acting on a guess.
 */
export interface EmailClassifier {
  readonly name: string;

  classify(request: ClassificationRequest): Promise<Result<Classification>>;
}

/** The raw model call, before the adapter attaches `source` and `model`. */
export interface ClassificationModel {
  readonly model: string;

  complete(request: ClassificationRequest): Promise<Result<ModelClassification>>;
}
