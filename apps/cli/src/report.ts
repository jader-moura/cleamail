import { CATEGORIES, type Category, type ClassificationOutcome, type Email } from "./ports.js";

/**
 * The dry-run report, as pure functions.
 *
 * Formatting lives apart from the command so the layout can be asserted in tests rather than
 * eyeballed, and so every line in it can be traced to something the pipeline produced. The report
 * is the Classify gate: if a user cannot read this and tell whether cleamail understood their
 * mailbox, the phase is not done.
 */

/** Categories the user is meant to act on. These are never cleaned. */
const ATTENTION: readonly Category[] = ["important", "needs_reply"];

/** Categories the policy engine will archive once it exists (SPEC-011). */
const CLEANABLE: readonly Category[] = ["newsletter", "promotion", "notification"];

const REVIEW_LABELS: Readonly<Record<string, string>> = {
  low_confidence: "unsure",
  invalid_model_output: "model output invalid",
  suspicious: "looks like a forgery",
};

export type ReportInput = {
  readonly emails: readonly Email[];
  readonly outcomes: readonly ClassificationOutcome[];
  /** The model that answered, so a report can be compared against another run. */
  readonly model: string;
};

/**
 * Makes attacker-controlled text safe to print.
 *
 * A subject is written by the sender, and a terminal interprets escape sequences: a crafted subject
 * could otherwise clear the screen or rewrite the line above it, which in a report about trust would
 * be its own kind of failure.
 */
export function plain(text: string, max = 48): string {
  const stripped = text
    // Whole CSI sequences first. Removing only the escape byte would disarm the sequence but leave
    // its parameters behind as visible junk, so `Sale\u001b[2Jgotcha` would print as `Sale [2Jgotcha`.
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (stripped === "") return "(no subject)";

  return stripped.length <= max ? stripped : `${stripped.slice(0, max - 1)}…`;
}

function senderOf(email: Email): string {
  const { name, address } = email.from;

  return plain(name === undefined || name === "" ? address : `${name} <${address}>`, 40);
}

export type Pairing = {
  readonly email: Email;
  readonly outcome: ClassificationOutcome;
};

/** Pairs outcomes with their emails, dropping any outcome whose email is not in the batch. */
export function pair(input: ReportInput): readonly Pairing[] {
  const byId = new Map(input.emails.map((email) => [String(email.id), email]));

  return input.outcomes.flatMap((outcome) => {
    const email = byId.get(String(outcome.emailId));

    return email === undefined ? [] : [{ email, outcome }];
  });
}

function categoryOf(pairing: Pairing): Category | undefined {
  return pairing.outcome.classification?.category;
}

/** Counts per category, in the fixed order, so two runs can be compared line by line. */
export function categoryCounts(pairings: readonly Pairing[]): ReadonlyMap<Category, number> {
  const counts = new Map<Category, number>();

  for (const category of CATEGORIES) {
    const total = pairings.filter((pairing) => categoryOf(pairing) === category).length;
    if (total > 0) counts.set(category, total);
  }

  return counts;
}

export function formatReport(input: ReportInput): readonly string[] {
  const pairings = pair(input);
  if (pairings.length === 0) {
    return ["Nothing to classify in that window."];
  }

  const review = pairings.filter((pairing) => pairing.outcome.reviewReason !== undefined);
  const settled = pairings.filter((pairing) => pairing.outcome.reviewReason === undefined);

  const attention = settled.filter((pairing) => {
    const category = categoryOf(pairing);

    return category !== undefined && ATTENTION.includes(category);
  });

  const cleanable = settled.filter((pairing) => {
    const category = categoryOf(pairing);

    return category !== undefined && CLEANABLE.includes(category);
  });

  const kept = settled.filter((pairing) => categoryOf(pairing) === "fyi");

  const lines: string[] = [];

  lines.push(...section(`needs attention (${String(attention.length)})`, detailed(attention)));
  lines.push(...section(`needs review (${String(review.length)})`, reviewLines(review)));
  lines.push(
    ...section(`would be cleaned (${String(cleanable.length)})`, counted(cleanable)),
    ...section(`kept as is (${String(kept.length)})`, counted(kept)),
    ...section("summary", summary(pairings, input.model)),
  );

  lines.push("Nothing in your mailbox was changed.");

  return lines;
}

function section(heading: string, body: readonly string[]): readonly string[] {
  if (body.length === 0) return [];

  return [heading, ...body, ""];
}

/** One email per entry, with the reason, because this is the list a user checks for mistakes. */
function detailed(pairings: readonly Pairing[]): readonly string[] {
  return pairings.flatMap(({ email, outcome }) => {
    const category = outcome.classification?.category ?? "unclassified";
    const reason = outcome.classification?.reason;

    return [
      `  ${category.padEnd(13)}${plain(email.subject)}`,
      `  ${" ".repeat(13)}${senderOf(email)}`,
      ...(reason === undefined ? [] : [`  ${" ".repeat(13)}${plain(reason, 70)}`]),
    ];
  });
}

function reviewLines(pairings: readonly Pairing[]): readonly string[] {
  return pairings.flatMap(({ email, outcome }) => {
    const why = REVIEW_LABELS[outcome.reviewReason ?? ""] ?? "needs a look";
    const category = outcome.classification?.category;
    const suffix = category === undefined ? "" : ` (looked like ${category})`;

    return [
      `  ${why.padEnd(22)}${plain(email.subject)}`,
      `  ${" ".repeat(22)}${senderOf(email)}${suffix}`,
    ];
  });
}

function counted(pairings: readonly Pairing[]): readonly string[] {
  return [...categoryCounts(pairings)].map(
    ([category, total]) => `  ${category.padEnd(13)}${String(total)}`,
  );
}

/**
 * The accounting line.
 *
 * The rule and model split is here because it is the honest measure of how much of this report came
 * from deterministic code, and the totals add up so a reader can tell nothing was dropped.
 */
function summary(pairings: readonly Pairing[], model: string): readonly string[] {
  const fromRules = pairings.filter(
    (pairing) => pairing.outcome.classification?.source === "rule",
  ).length;
  const unclassified = pairings.filter(
    (pairing) => pairing.outcome.classification === undefined,
  ).length;
  const fromModel = pairings.length - fromRules - unclassified;

  return [
    `  classified    ${String(pairings.length)}`,
    `  by rules      ${String(fromRules)} (no model call)`,
    `  by model      ${String(fromModel)} (${model})`,
    ...(unclassified === 0 ? [] : [`  unreadable    ${String(unclassified)}`]),
  ];
}
