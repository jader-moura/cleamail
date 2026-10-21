import { isRemoving, type Action } from "../domain/action.js";
import type { Decision } from "../domain/decision.js";
import type { Email } from "../domain/email.js";
import { LABEL_CLEANED, LABEL_REVIEW, LABEL_SUSPICIOUS } from "../domain/labels.js";
import type { ClassificationOutcome } from "../pipeline/classify.js";
import { findListEntry } from "../rules/matching.js";
import { DEFAULT_POLICY_SETTINGS, type PolicySettings } from "./settings.js";

/**
 * The policy that produced a decision.
 *
 * Stored on every decision so one written months ago stays readable after the rules here change.
 * Bump it whenever the actions for a given classification change.
 */
export const POLICY_VERSION = "p1";

export type PolicyInput = {
  readonly email: Email;
  readonly outcome: ClassificationOutcome;
  /** Defaults to the cautious settings, which is what a fresh install runs. */
  readonly settings?: PolicySettings;
  /** Passed in rather than read, so the engine stays a pure function. */
  readonly now: Date;
};

/**
 * The only place in cleamail that decides what happens to an email.
 *
 * Pure: no clock, no store, no provider, no network. It plans from the category, then applies the
 * safety overrides as a filter that can only remove actions. Nothing here applies anything; the
 * executor in SPEC-012 does that, and it skips the actions that would change nothing.
 */
export function decide(input: PolicyInput): Decision {
  const { email, outcome } = input;
  const settings = input.settings ?? DEFAULT_POLICY_SETTINGS;

  return {
    emailId: email.id,
    accountId: email.accountId,
    ...(outcome.classification === undefined ? {} : { classification: outcome.classification }),
    ...(outcome.reviewReason === undefined ? {} : { reviewReason: outcome.reviewReason }),
    ...(outcome.reviewDetail === undefined ? {} : { reviewDetail: outcome.reviewDetail }),
    actions: withoutCleaning(plan(email, outcome, settings), email, settings),
    policyVersion: POLICY_VERSION,
    decidedAt: input.now,
  };
}

/** The one sentence shown next to a decision. Derived, so it can never drift from the decision. */
export function explainDecision(decision: Decision): string {
  if (decision.classification !== undefined) return decision.classification.reason;

  return decision.reviewDetail ?? "The model's answer could not be used, so nothing was done.";
}

/** True when the decision would take the email out of the inbox. What the eval measures. */
export function removesFromInbox(decision: Decision): boolean {
  return decision.actions.some((action) => isRemoving(action));
}

function plan(email: Email, outcome: ClassificationOutcome, settings: PolicySettings): Action[] {
  const { classification } = outcome;

  // Nothing to reason from, so nothing is done beyond putting it where the user will see it.
  if (classification === undefined) return [label(email, LABEL_REVIEW)];

  // Before the general review branch: `suspicious` has its own label, and a message that looks
  // like it is trying to take something should say so rather than read as low confidence.
  if (classification.category === "suspicious") return [label(email, LABEL_SUSPICIOUS)];

  if (outcome.reviewReason !== undefined) return [label(email, LABEL_REVIEW)];

  switch (classification.category) {
    case "important":
    case "needs_reply":
      // Kept in the inbox. Starring is the whole action, and it is reversible.
      return settings.starImportant ? [star(email)] : [];

    case "fyi":
      // In neither the protected nor the cleanable set, so it keeps its place with no label and no
      // star. Doing nothing is the decision, not a gap in this switch.
      return [];

    case "newsletter":
    case "promotion":
    case "notification": {
      const actions: Action[] = [label(email, LABEL_CLEANED)];

      if (settings.archiveCleaned) actions.push(archive(email));
      if (settings.markCleanedRead) actions.push(markRead(email));

      return actions;
    }
  }

  // No `suspicious` case: the check above catches it whichever way the outcome was built, and the
  // compiler proves this switch never sees it.
}

/**
 * The safety overrides.
 *
 * Written as a filter on purpose: an override may only take an action away, never add one, so no
 * amount of settings or future rules can turn "never touch this" into something that touches it.
 *
 * Two things earn it. A sender on the allowlist, because the user said so, and a message the user
 * starred, because they already marked it themselves. The rules layer also turns an allowlisted
 * sender into `important`, so this is the second belt rather than the only one.
 */
function withoutCleaning(actions: Action[], email: Email, settings: PolicySettings): Action[] {
  const onAllowlist = findListEntry(email.from, settings.allowlist) !== undefined;

  if (!onAllowlist && !email.isStarred) return actions;

  return actions.filter((action) => !isCleaning(action));
}

/** Everything that hides a message or marks it dealt with. A star and a review label do neither. */
function isCleaning(action: Action): boolean {
  if (action.type === "label") return action.label === LABEL_CLEANED;

  return isRemoving(action) || action.type === "mark_read";
}

function label(email: Email, name: string): Action {
  // The previous state travels with the action, so undo never has to guess and the executor can
  // tell a real change from a no-op.
  return { type: "label", label: name, hadLabel: email.providerLabels.includes(name) };
}

function star(email: Email): Action {
  return { type: "star", wasStarred: email.isStarred };
}

function archive(email: Email): Action {
  return { type: "archive", wasInInbox: email.isInInbox };
}

function markRead(email: Email): Action {
  return { type: "mark_read", wasRead: email.isRead };
}
