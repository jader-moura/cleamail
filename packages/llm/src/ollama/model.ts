import {
  ModelClassificationSchema,
  failure,
  ok,
  type ClassificationModel,
  type ClassificationRequest,
  type ModelClassification,
  type Result,
} from "@cleamail/core";
import type { z } from "zod";
import { classifyPrompt } from "../prompts/index.js";
import type { ClassifyPrompt, PromptVersion } from "../prompts/types.js";
import { OllamaClient, type OllamaClientOptions } from "./client.js";
import { CLASSIFICATION_JSON_SCHEMA } from "./schema.js";
import type { OllamaSamplingOptions } from "./types.js";

/**
 * The documented default.
 *
 * It has to be a text-only model small enough for `init` to pull on a stranger's laptop, which is
 * why it is not whichever model happens to be installed on a developer's machine. SPEC-019 replaces
 * this with a benchmarked choice, and the CLI lets anyone override it today.
 */
export const DEFAULT_CLASSIFIER_MODEL = "qwen2.5:7b";

/**
 * Fixed sampling. A classifier has no use for creativity, and evals are only comparable when the
 * same email and prompt produce the same answer.
 */
const SAMPLING: OllamaSamplingOptions = {
  temperature: 0,
  seed: 1,
  // One small JSON object. A cap means a rambling model fails fast instead of filling the context.
  num_predict: 300,
};

export type OllamaModelOptions = OllamaClientOptions & {
  readonly model?: string;
  readonly promptVersion?: PromptVersion;
};

/** Turns one email into one raw model classification. Attaches nothing and decides nothing. */
export class OllamaClassificationModel implements ClassificationModel {
  private constructor(
    readonly model: string,
    private readonly client: OllamaClient,
    private readonly prompt: ClassifyPrompt,
  ) {}

  static create(options: OllamaModelOptions = {}): Result<OllamaClassificationModel> {
    const client = OllamaClient.create(options);
    if (!client.ok) return client;

    return ok(
      new OllamaClassificationModel(
        options.model ?? DEFAULT_CLASSIFIER_MODEL,
        client.value,
        classifyPrompt(options.promptVersion),
      ),
    );
  }

  /** The prompt version in use, so an eval report can name it. */
  get promptVersion(): PromptVersion {
    return this.prompt.version;
  }

  async complete(request: ClassificationRequest): Promise<Result<ModelClassification>> {
    const response = await this.client.chat({
      model: this.model,
      system: this.prompt.system,
      user: this.prompt.render({
        email: request.email,
        hints: request.hints,
        examples: request.examples,
      }),
      format: CLASSIFICATION_JSON_SCHEMA,
      options: SAMPLING,
    });

    if (!response.ok) return response;

    // A model with a thinking mode spends the reply budget on reasoning and returns an empty
    // message, so every email fails for the same reason with nothing to point at. Measured on
    // qwen3-vl:8b: 13,571 characters of reasoning and no answer, even with the cap raised to 4000
    // tokens. Worth its own message, because the fix is to change models and no amount of
    // re-running will reveal that.
    if (response.value.trim() === "") {
      return failure(
        "invalid_model_output",
        `${this.model} answered with reasoning and no classification. Models that think before answering spend the whole reply on it. Use one without a thinking mode, such as ${DEFAULT_CLASSIFIER_MODEL}.`,
      );
    }

    const json = parseJson(response.value);
    if (json === undefined) {
      return failure(
        "invalid_model_output",
        `${this.model} replied with something that is not JSON.`,
      );
    }

    const parsed = ModelClassificationSchema.safeParse(json);
    if (!parsed.success) {
      return failure(
        "invalid_model_output",
        `${this.model} returned a classification that failed validation (${describeIssues(parsed.error)}).`,
      );
    }

    return ok(parsed.data);
  }
}

/**
 * Accepts a bare object, and tolerates a markdown fence around it.
 *
 * Being lenient here is safe because the result is still validated: a fenced object is a formatting
 * quirk, while prose remains a failure either way.
 */
function parseJson(text: string): unknown {
  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    return JSON.parse(unfenced);
  } catch {
    return undefined;
  }
}

/**
 * Field names and failure kinds only.
 *
 * This string is logged, and a Zod message can quote the value it rejected. A rejected `reason` is
 * model output that may be echoing the email, so the values are left out: "never log full email
 * bodies" has to hold on the error path too.
 */
function describeIssues(error: z.ZodError): string {
  const issues = error.issues
    .slice(0, 4)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.code}`);

  return issues.join(", ");
}
