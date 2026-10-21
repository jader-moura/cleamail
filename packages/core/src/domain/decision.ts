import { z } from "zod";
import { ActionSchema } from "./action.js";
import { ClassificationSchema } from "./classification.js";
import { AccountIdSchema, EmailIdSchema } from "./ids.js";

/** Why a decision needs a human: shown in the dashboard's review list. */
export const REVIEW_REASONS = ["low_confidence", "invalid_model_output", "suspicious"] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

/**
 * One email, one classification, and the actions the policy engine planned for it.
 *
 * A decision is produced before anything is applied, which is what makes the dry-run preview and
 * the audit log the same object seen at two different moments.
 */
export const DecisionSchema = z.object({
  emailId: EmailIdSchema,
  accountId: AccountIdSchema,
  /**
   * Absent when the model returned something invalid.
   *
   * A decision without a classification is still a decision: the plan is to label
   * `cleamail/Review` and stop. It has to be recordable, because an audit log missing exactly the
   * cases that went wrong is the one nobody can trust.
   */
  classification: ClassificationSchema.optional(),
  /** Set when a human should look at this instead of cleamail acting on it. */
  reviewReason: z.enum(REVIEW_REASONS).optional(),
  /** cleamail's own words about what went wrong. Never email content. */
  reviewDetail: z.string().min(1).optional(),
  actions: z.array(ActionSchema).default([]),
  /** Version of the policy that produced this, so old decisions stay explainable. */
  policyVersion: z.string().min(1),
  decidedAt: z.coerce.date(),
});

export type Decision = z.infer<typeof DecisionSchema>;
