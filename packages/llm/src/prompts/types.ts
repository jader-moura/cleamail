import type { ClassificationExample, ClassifiableEmail, RuleHint } from "@cleamail/core";

/**
 * A prompt version.
 *
 * Prompts are versioned files rather than strings built at the call site, because changing one
 * changes the product's accuracy. CLAUDE.md requires an eval run for any prompt change, and an eval
 * report is only meaningful if it can name the exact version it measured.
 */
export type PromptVersion = "v1";

export type PromptInput = {
  readonly email: ClassifiableEmail;
  // Spelled `| undefined` so a caller forwarding an absent field from `ClassificationRequest` does
  // not trip `exactOptionalPropertyTypes`.
  readonly hints?: readonly RuleHint[] | undefined;
  readonly examples?: readonly ClassificationExample[] | undefined;
};

export type ClassifyPrompt = {
  readonly version: PromptVersion;
  /** Instructions. Never contains email content. */
  readonly system: string;
  /** The email, fenced as untrusted data, plus the output contract repeated after it. */
  render(input: PromptInput): string;
};
