import { classifyPromptV1 } from "./classify-v1.js";
import type { ClassifyPrompt, PromptVersion } from "./types.js";

export * from "./fence.js";
export * from "./types.js";
export { classifyPromptV1 };

/**
 * Every prompt version, by name.
 *
 * Old versions stay here once they exist. An eval report names the version it measured, and a
 * report that cannot be reproduced is not evidence of anything.
 */
export const CLASSIFY_PROMPTS: Readonly<Record<PromptVersion, ClassifyPrompt>> = {
  v1: classifyPromptV1,
};

/** The version used when a caller does not pick one. */
export const ACTIVE_PROMPT_VERSION: PromptVersion = "v1";

export function classifyPrompt(version: PromptVersion = ACTIVE_PROMPT_VERSION): ClassifyPrompt {
  return CLASSIFY_PROMPTS[version];
}
