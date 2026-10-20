import {
  ClassificationSchema,
  failure,
  ok,
  type Category,
  type Classification,
  type ClassificationRequest,
  type EmailClassifier,
  type Result,
} from "@cleamail/core";

export type FakeClassifierOptions = {
  /** The category every email gets. */
  readonly category?: Category;
  readonly importance?: number;
  readonly confidence?: number;
  /** When set, every call fails with this, for testing the fallback to `cleamail/Review`. */
  readonly failWith?: "invalid_model_output" | "provider_unavailable";
};

/**
 * A classifier that answers instantly and predictably.
 *
 * For the packages downstream of this one: the CLI, the policy engine in SPEC-011 and the dashboard
 * all need a classifier to compose, and none of them should need a model to run their tests.
 */
export class FakeClassifier implements EmailClassifier {
  readonly name = "fake";
  readonly requests: ClassificationRequest[] = [];

  constructor(private readonly options: FakeClassifierOptions = {}) {}

  // Not `async`: there is nothing to await, and the port only asks for a promise.
  classify(request: ClassificationRequest): Promise<Result<Classification>> {
    this.requests.push(request);

    if (this.options.failWith !== undefined) {
      return Promise.resolve(
        failure(this.options.failWith, "The fake classifier was asked to fail."),
      );
    }

    return Promise.resolve(
      ok(
        ClassificationSchema.parse({
          category: this.options.category ?? "fyi",
          importance: this.options.importance ?? 0.5,
          confidence: this.options.confidence ?? 0.9,
          reason: "The fake classifier answers the same way every time.",
          source: "model",
          model: this.name,
        }),
      ),
    );
  }
}
