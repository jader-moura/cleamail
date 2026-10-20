import { z } from "zod";

/**
 * What cleamail may do to a message. The list is closed on purpose: there is no "delete", and
 * `trash` is the furthest it ever goes.
 *
 * Every variant carries the state it found before acting, so undo never has to guess. An action
 * that cannot describe how to reverse itself cannot be represented here.
 */
export const ACTION_TYPES = ["label", "star", "archive", "mark_read", "trash"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const LabelActionSchema = z.object({
  type: z.literal("label"),
  label: z.string().min(1),
  /** Whether the message already had the label, so undo knows whether to remove it. */
  hadLabel: z.boolean(),
});

export const StarActionSchema = z.object({
  type: z.literal("star"),
  wasStarred: z.boolean(),
});

export const ArchiveActionSchema = z.object({
  type: z.literal("archive"),
  wasInInbox: z.boolean(),
});

export const MarkReadActionSchema = z.object({
  type: z.literal("mark_read"),
  wasRead: z.boolean(),
});

export const TrashActionSchema = z.object({
  type: z.literal("trash"),
  wasInInbox: z.boolean(),
  /** Labels to restore if the user undoes this while the provider still holds the message. */
  previousLabels: z.array(z.string()).default([]),
});

export const ActionSchema = z.discriminatedUnion("type", [
  LabelActionSchema,
  StarActionSchema,
  ArchiveActionSchema,
  MarkReadActionSchema,
  TrashActionSchema,
]);

export type Action = z.infer<typeof ActionSchema>;
export type LabelAction = z.infer<typeof LabelActionSchema>;
export type StarAction = z.infer<typeof StarActionSchema>;
export type ArchiveAction = z.infer<typeof ArchiveActionSchema>;
export type MarkReadAction = z.infer<typeof MarkReadActionSchema>;
export type TrashAction = z.infer<typeof TrashActionSchema>;

/**
 * True when applying the action would change nothing. The policy engine can plan freely and the
 * executor skips no-ops, which keeps the audit log honest about what actually changed.
 */
export function isNoOp(action: Action): boolean {
  switch (action.type) {
    case "label":
      return action.hadLabel;
    case "star":
      return action.wasStarred;
    case "archive":
      return !action.wasInInbox;
    case "mark_read":
      return action.wasRead;
    case "trash":
      return false;
  }
}

/** Actions that move a message out of sight. These are the ones undo exists for. */
export function isRemoving(action: Action): boolean {
  return action.type === "archive" || action.type === "trash";
}
