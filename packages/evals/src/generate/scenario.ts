import type { Category } from "@cleamail/core";

/** Who the message was addressed to, which is a signal in itself. */
export type Recipients = "me" | "list" | "many" | "undisclosed";

/**
 * One hand-written situation, expanded into several cases.
 *
 * Templates carry `{placeholders}` filled from the pools, so the variants differ in names,
 * companies and amounts without anyone writing the same email five times. The judgement in a
 * scenario is the part that cannot be generated: which category it really is, which other label
 * would be defensible, and which label would be a failure.
 */
export type Scenario = {
  /** kebab-case, and the stem of every case id it produces. */
  readonly id: string;
  readonly expect: Category;
  readonly acceptable?: readonly Category[];
  readonly mustNot?: readonly Category[];
  readonly tags?: readonly string[];
  /** How many cases to expand this into. */
  readonly count: number;
  /** `Name <local@{domain}>` or a bare address. */
  readonly from: string;
  readonly subject: string;
  readonly body: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly labels?: readonly string[];
  readonly to?: Recipients;
  readonly ageHours?: number;
  /** Puts the first variant in the 20-case smoke set. */
  readonly smoke?: boolean;
};
