import { z } from "zod";
import { DEFAULT_CONFIDENCE_THRESHOLD } from "../pipeline/classify.js";

/**
 * What the user gets to change about the policy.
 *
 * Every default here is the cautious one. The dashboard writes these in SPEC-016; until then the
 * CLI passes the defaults, and the engine takes them as an argument so nothing has to read a file
 * to work out what cleamail would do.
 */
export const PolicySettingsSchema = z.object({
  /** Below this, an email goes to the user instead of being acted on. */
  confidenceThreshold: z.number().min(0).max(1).default(DEFAULT_CONFIDENCE_THRESHOLD),
  /**
   * Archive the cleanable categories as well as labelling them.
   *
   * Off is a supported way to run cleamail, not a debug flag: everything still gets
   * `cleamail/Cleaned` and nothing leaves the inbox, which is how a cautious user tries it for a
   * week before letting it move anything.
   */
  archiveCleaned: z.boolean().default(true),
  /**
   * Also mark cleaned mail as read.
   *
   * Off by default. Unread is how a user finds what they have not seen, and an empty bold count is
   * not worth hiding something behind.
   */
  markCleanedRead: z.boolean().default(false),
  /** Star what matters, so it stands out in a mail client cleamail does not control. */
  starImportant: z.boolean().default(true),
  /**
   * Senders the user never wants cleaned, as addresses or bare domains.
   *
   * The rules layer already turns these into `important`, so this is the second belt: whatever the
   * classification says, nothing from one of these leaves the inbox.
   */
  allowlist: z.array(z.string()).default([]),
});

export type PolicySettings = z.infer<typeof PolicySettingsSchema>;

export const DEFAULT_POLICY_SETTINGS: PolicySettings = PolicySettingsSchema.parse({});
