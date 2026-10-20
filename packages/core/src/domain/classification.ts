import { z } from "zod";
import { CategorySchema } from "./category.js";

/** A score in `0..1`. Used for both importance and confidence. */
export const ScoreSchema = z.number().min(0).max(1);

/**
 * The only thing a classifier may return. The model has no tools and cannot pick actions: it
 * produces this shape, Zod validates it, and the policy engine decides what happens.
 *
 * `reason` is shown to the user next to every decision, so it is required and kept to one sentence.
 */
export const ClassificationSchema = z.object({
  category: CategorySchema,
  importance: ScoreSchema,
  confidence: ScoreSchema,
  reason: z.string().trim().min(1).max(240),
  source: z.enum(["rule", "model"]),
  /** Set when `source` is `rule`. */
  ruleId: z.string().min(1).optional(),
  /** Set when `source` is `model`, e.g. `qwen2.5:7b`. */
  model: z.string().min(1).optional(),
});

export type Classification = z.infer<typeof ClassificationSchema>;

/**
 * What a model is allowed to return. It never gets to claim a source, a rule id or a model name:
 * the adapter fills those in, so a prompt injection cannot pass itself off as a rule match.
 */
export const ModelClassificationSchema = ClassificationSchema.pick({
  category: true,
  importance: true,
  confidence: true,
  reason: true,
});

export type ModelClassification = z.infer<typeof ModelClassificationSchema>;

/** A past user correction, reused as a few-shot example in SPEC-017. */
export const ClassificationExampleSchema = z.object({
  subject: z.string(),
  fromAddress: z.string(),
  bodyExcerpt: z.string(),
  category: CategorySchema,
});

export type ClassificationExample = z.infer<typeof ClassificationExampleSchema>;
