/**
 * Labels cleamail owns. Both the policy engine and the mail adapters need the exact same strings,
 * so they live in the domain and are never spelled out again anywhere else.
 */
export const LABEL_CLEANED = "cleamail/Cleaned";
export const LABEL_REVIEW = "cleamail/Review";
export const LABEL_SUSPICIOUS = "cleamail/Suspicious";

export const RESERVED_LABELS = [LABEL_CLEANED, LABEL_REVIEW, LABEL_SUSPICIOUS] as const;

export type ReservedLabel = (typeof RESERVED_LABELS)[number];

export function isReservedLabel(label: string): label is ReservedLabel {
  return (RESERVED_LABELS as readonly string[]).includes(label);
}
