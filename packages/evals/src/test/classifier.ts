import {
  ClassificationSchema,
  failure,
  ok,
  type Category,
  type Classification,
  type ClassificationRequest,
  type EmailClassifier,
  type ErrorCode,
  type Result,
} from "@cleamail/core";

export type ScriptedAnswer =
  | Category
  | { readonly category: Category; readonly confidence?: number }
  | { readonly fail: ErrorCode };

/**
 * A classifier that answers from a script.
 *
 * The runner has to be testable without a model, and `FakeClassifier` in `@cleamail/llm` answers
 * the same way for every email, which cannot produce a confusion matrix worth asserting on. This
 * one answers per email id, so a test can arrange exactly the mix of right, wrong, unsure and
 * broken answers it wants to measure.
 */
export class ScriptedClassifier implements EmailClassifier {
  readonly name = "scripted";
  readonly seen: string[] = [];

  constructor(
    private readonly answers: Readonly<Record<string, ScriptedAnswer>>,
    private readonly fallback: ScriptedAnswer = "fyi",
  ) {}

  classify(request: ClassificationRequest): Promise<Result<Classification>> {
    const id = String(request.email.id);
    this.seen.push(id);

    const answer = this.answers[id] ?? this.fallback;

    if (typeof answer === "object" && "fail" in answer) {
      return Promise.resolve(failure(answer.fail, "The scripted classifier was asked to fail."));
    }

    const { category, confidence } =
      typeof answer === "string" ? { category: answer, confidence: undefined } : answer;

    return Promise.resolve(
      ok(
        ClassificationSchema.parse({
          category,
          importance: 0.5,
          confidence: confidence ?? 0.9,
          reason: "The scripted classifier answers from its script.",
          source: "model",
          model: this.name,
        }),
      ),
    );
  }
}
