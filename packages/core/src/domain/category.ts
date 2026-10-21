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

/**
 * Categories the policy cleans by default: labelled `cleamail/Cleaned` and archived.
 *
 * The complement of {@link PROTECTED_CATEGORIES} is not this set, and that gap is deliberate. `fyi`
 * is in neither: it is not worth starring and not noise worth archiving, so it stays in the inbox
 * with nothing done to it. SPEC-011's policy engine and the eval metrics both read this constant,
 * which is what keeps "would this have been archived" the same question in both places.
 */
export const CLEANABLE_CATEGORIES: readonly Category[] = [
  "newsletter",
  "promotion",
  "notification",
];

export function isCleanableCategory(category: Category): boolean {
  return CLEANABLE_CATEGORIES.includes(category);
}
