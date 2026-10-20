import { z } from "zod";

/**
 * The category set is fixed in v0.1. Adding a category changes the policy engine, the prompts and
 * the eval set, so it is a deliberate, measured change and not a drive-by edit.
 */
export const CATEGORIES = [
  "important",
  "needs_reply",
  "fyi",
  "newsletter",
  "promotion",
  "notification",
  "suspicious",
] as const;

export const CategorySchema = z.enum(CATEGORIES);
export type Category = z.infer<typeof CategorySchema>;

/** Categories that must stay in the inbox and are never cleaned automatically. */
export const PROTECTED_CATEGORIES: readonly Category[] = ["important", "needs_reply", "suspicious"];

export function isProtectedCategory(category: Category): boolean {
  return PROTECTED_CATEGORIES.includes(category);
}
