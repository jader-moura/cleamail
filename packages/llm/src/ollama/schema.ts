import { ModelClassificationSchema } from "@cleamail/core";
import { z } from "zod";

/**
 * The JSON schema Ollama uses to constrain generation.
 *
 * Generated from the same Zod schema that validates the response, so the constraint and the
 * validation cannot drift apart. Constraining the model is a convenience, not a guarantee: the
 * answer is parsed through Zod regardless, because a local server could be any version and
 * structured output is a best effort inside the sampler.
 *
 * `unrepresentable: "any"` lets through the refinements JSON Schema has no word for, such as the
 * trim on `reason`. Those are still enforced by Zod when the response comes back.
 */
export const CLASSIFICATION_JSON_SCHEMA: unknown = z.toJSONSchema(ModelClassificationSchema, {
  io: "input",
  unrepresentable: "any",
});
