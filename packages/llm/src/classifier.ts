import {
  ClassificationSchema,
  failure,
  ok,
  type Classification,
  type ClassificationModel,
  type ClassificationRequest,
  type EmailClassifier,
  type Result,
} from "@cleamail/core";
import { OllamaClassificationModel, type OllamaModelOptions } from "./ollama/model.js";

/**
 * Wraps a raw model in the `EmailClassifier` port.
 *
 * This is the layer that attaches `source: "model"` and the model name. The model itself never gets
 * to set them, so no amount of injected text can make a model answer look like a rule match or
 * claim to come from a different model than the one that produced it.
 */
export class ModelBackedClassifier implements EmailClassifier {
  readonly name: string;

  constructor(private readonly model: ClassificationModel) {
    this.name = model.model;
  }

  async classify(request: ClassificationRequest): Promise<Result<Classification>> {
    const completion = await this.model.complete(request);
    if (!completion.ok) return completion;

    // Parsed rather than spread into a cast: this is the value the policy engine will act on, so
    // the one place it is assembled is the place that proves it is well formed.
    const parsed = ClassificationSchema.safeParse({
      ...completion.value,
      source: "model",
      model: this.model.model,
    });

    if (!parsed.success) {
      return failure(
        "invalid_model_output",
        `${this.model.model} produced a classification that could not be completed.`,
      );
    }

    return ok(parsed.data);
  }
}

/** The composition most callers want: an Ollama-backed classifier, or a reason it cannot be built. */
export function createOllamaClassifier(options: OllamaModelOptions = {}): Result<EmailClassifier> {
  const model = OllamaClassificationModel.create(options);
  if (!model.ok) return model;

  return ok(new ModelBackedClassifier(model.value));
}
