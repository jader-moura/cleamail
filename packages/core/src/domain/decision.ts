import { z } from "zod";
import { ActionSchema } from "./action.js";
import { ClassificationSchema } from "./classification.js";
import { AccountIdSchema, EmailIdSchema } from "./ids.js";

/**
 * One email, one classification, and the actions the policy engine planned for it.
 *
 * A decision is produced before anything is applied, which is what makes the dry-run preview and
 * the audit log the same object seen at two different moments.
 */
export const DecisionSchema = z.object({
  emailId: EmailIdSchema,
  accountId: AccountIdSchema,
  classification: ClassificationSchema,
  actions: z.array(ActionSchema).default([]),
  /** Version of the policy that produced this, so old decisions stay explainable. */
  policyVersion: z.string().min(1),
  decidedAt: z.coerce.date(),
});

export type Decision = z.infer<typeof DecisionSchema>;

/** Why a decision needs a human: shown in the dashboard's review list. */
export const REVIEW_REASONS = ["low_confidence", "invalid_model_output", "suspicious"] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];
