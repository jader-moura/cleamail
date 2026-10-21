import { z } from "zod";
import {
  CategorySchema,
  EmailAddressSchema,
  HeadersSchema,
  type Category,
  type EmailAddress,
} from "@cleamail/core";

/**
 * One synthetic email as it sits on disk.
 *
 * Deliberately smaller than `Email`: no ids, no flags, no absolute dates. The ids are derived when
 * a case is loaded, and the age is relative so a dataset committed today still describes "an email
 * from yesterday" a year from now. A fixed timestamp would slowly turn every case into an old one,
 * and "is this still relevant" is a signal the model is being asked to weigh.
 */
export const EvalEmailSchema = z.object({
  from: EmailAddressSchema,
  to: z.array(EmailAddressSchema).default([]),
  subject: z.string().default(""),
  body: z.string().default(""),
  headers: HeadersSchema.default({}),
  providerLabels: z.array(z.string()).default(["INBOX"]),
  /** How long before the run clock this arrived. */
  ageHours: z.number().nonnegative().default(24),
});

export type EvalEmail = z.infer<typeof EvalEmailSchema>;

export const EvalCaseSchema = z.object({
  id: z.string().min(1),
  /** The scenario this was expanded from, so a cluster of related failures is visible as one. */
  scenario: z.string().min(1),
  /** The label a careful human would give. */
  expect: CategorySchema,
  /**
   * Other labels a careful human could defend. Counted as correct.
   *
   * A shipping update is honestly arguable between `notification` and `fyi`. Marking that wrong
   * would make the score measure the grader's taste rather than the classifier's judgement.
   */
  acceptable: z.array(CategorySchema).default([]),
  /**
   * Labels that are a failure even if something in the email argues for them.
   *
   * This is where an injection case keeps its real assertion: the body is trying to produce
   * `important`, so "not important" is the thing being tested, separately from which label is best.
   */
  mustNot: z.array(CategorySchema).default([]),
  /** Slices for the report: `injection`, `receipt`, `spoof`, `smoke`. */
  tags: z.array(z.string()).default([]),
  email: EvalEmailSchema,
});

export type EvalCase = z.infer<typeof EvalCaseSchema>;

/** True when this category is the expected one or one of the defensible alternatives. */
export function isAcceptableCategory(evalCase: EvalCase, category: Category): boolean {
  return category === evalCase.expect || evalCase.acceptable.includes(category);
}

export function hasTag(evalCase: EvalCase, tag: string): boolean {
  return evalCase.tags.includes(tag);
}

/**
 * Serializes a case with its keys in a fixed order.
 *
 * The dataset is committed, so its bytes are reviewed in diffs and pinned by a test. Relying on
 * whichever order a schema parse or an object literal happened to produce would make an unrelated
 * refactor look like a change to the measurement.
 */
export function serializeCase(evalCase: EvalCase): string {
  const { email } = evalCase;

  return JSON.stringify({
    id: evalCase.id,
    scenario: evalCase.scenario,
    expect: evalCase.expect,
    acceptable: evalCase.acceptable,
    mustNot: evalCase.mustNot,
    tags: evalCase.tags,
    email: {
      from: sortedAddress(email.from),
      to: email.to.map(sortedAddress),
      subject: email.subject,
      body: email.body,
      headers: sortedHeaders(email.headers),
      providerLabels: email.providerLabels,
      ageHours: email.ageHours,
    },
  });
}

function sortedAddress(address: EmailAddress): unknown {
  return address.name === undefined
    ? { address: address.address }
    : { address: address.address, name: address.name };
}

function sortedHeaders(headers: Record<string, string>): Record<string, string> {
  const sorted: Record<string, string> = {};

  for (const key of Object.keys(headers).sort()) {
    const value = headers[key];
    if (value !== undefined) sorted[key] = value;
  }

  return sorted;
}
