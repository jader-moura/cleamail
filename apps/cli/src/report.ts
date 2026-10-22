import {
  CATEGORIES,
  decide,
  explainDecision,
  removesFromInbox,
  type Action,
  type Category,
  type ClassificationOutcome,
  type Decision,
  type Email,
  type PolicySettings,
} from "./ports.js";

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
  /** The run clock, which every decision is stamped with. */
  readonly now: Date;
  /** Defaults to the cautious settings, which is what a fresh install runs. */
  readonly settings?: PolicySettings;
  /**
   * Print nothing that came out of an email.
   *
   * For showing a run to someone else, or pasting it into a bug report. Subjects and senders are
   * obviously content, but so is `reason`: the model writes it by paraphrasing the email, so
   * "confirms your mortgage payment of 1,240.00" is just the email again in fewer words. Redacted
   * rows therefore carry only what cleamail concluded, numbered so the owner of the mailbox can
   * line a row up against their own inbox and say which ones are wrong.
   */
  readonly redact?: boolean;
  /**
   * The plan is about to be applied, so the report must not promise otherwise.
   *
   * The closing line is the last thing a user reads, and "nothing was changed" under a run that is
   * changing things would be the worst sentence in the product.
   */
  readonly applying?: boolean;
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
  /**
   * What the policy engine would do, asked rather than guessed.
   *
   * This report used to carry its own copy of the cleanable category list, which meant the dry run
   * and the engine could disagree about what was about to happen. Now there is one answer and the
   * report is a view of it.
   */
  readonly decision: Decision;
};

/** Pairs outcomes with their emails, dropping any outcome whose email is not in the batch. */
export function pair(input: ReportInput): readonly Pairing[] {
  const byId = new Map(input.emails.map((email) => [String(email.id), email]));

  return input.outcomes.flatMap((outcome) => {
    const email = byId.get(String(outcome.emailId));
    if (email === undefined) return [];

    return [
      {
        email,
        outcome,
        decision: decide({
          email,
          outcome,
          ...(input.settings === undefined ? {} : { settings: input.settings }),
          now: input.now,
        }),
      },
    ];
  });
}

function categoryOf(pairing: Pairing): Category | undefined {
  return pairing.outcome.classification?.category;
}

function isAttention(pairing: Pairing): boolean {
  const category = categoryOf(pairing);

  return category !== undefined && ATTENTION.includes(category);
}

/**
 * Every action the engine planned, counted by kind.
 *
 * The point of printing this is that it is the thing that will actually happen. A user reading the
 * categories above is checking cleamail's judgement; a user reading this is checking its reach.
 */
function plannedActions(pairings: readonly Pairing[]): readonly string[] {
  const counts = new Map<string, number>();

  for (const { decision } of pairings) {
    for (const action of decision.actions) {
      const name = describeAction(action);

      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  const untouched = pairings.filter((pairing) => pairing.decision.actions.length === 0).length;

  return [
    ...[...counts].map(([name, total]) => `  ${name.padEnd(28)}${String(total)}`),
    ...(untouched === 0 ? [] : [`  ${"leave alone".padEnd(28)}${String(untouched)}`]),
  ];
}

function describeAction(action: Action): string {
  switch (action.type) {
    case "label":
      return `label ${action.label}`;
    case "star":
      return "star";
    case "archive":
      return "archive";
    case "mark_read":
      return "mark read";
    case "trash":
      return "move to trash";
  }
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

  if (input.redact === true) {
    return redactedReport(pairings, input.model, input.applying === true);
  }

  const review = pairings.filter((pairing) => pairing.outcome.reviewReason !== undefined);
  const settled = pairings.filter((pairing) => pairing.outcome.reviewReason === undefined);

  const attention = settled.filter(isAttention);

  // Membership comes from the plan, not from the category, so a setting that turns archiving off
  // moves these emails into "kept as is" in the report exactly as it does in the mailbox.
  const cleanable = settled.filter((pairing) => removesFromInbox(pairing.decision));
  const kept = settled.filter(
    (pairing) => !removesFromInbox(pairing.decision) && !isAttention(pairing),
  );

  const lines: string[] = [];

  lines.push(...section(`needs attention (${String(attention.length)})`, detailed(attention)));
  lines.push(...section(`needs review (${String(review.length)})`, reviewLines(review)));
  lines.push(
    ...section(`would be cleaned (${String(cleanable.length)})`, counted(cleanable)),
    ...section(`kept as is (${String(kept.length)})`, counted(kept)),
    ...section("would do", plannedActions(pairings)),
    ...section("summary", summary(pairings, input.model)),
  );

  lines.push(closing(input.applying === true));

  return lines;
}

/**
 * The same run with every trace of the mail itself removed.
 *
 * One numbered row per email: when it arrived, what cleamail decided, how sure it was, and whether
 * a rule or the model decided it. The date stays because it is what lets the mailbox owner find the
 * email again; no subject, no address and no model-written reason appear at all.
 */
function redactedReport(
  pairings: readonly Pairing[],
  model: string,
  applying: boolean,
): readonly string[] {
  const rows = pairings.map((pairing, index) => {
    const { classification, reviewReason } = pairing.outcome;
    const when = pairing.email.receivedAt.toISOString().slice(0, 16).replace("T", " ");
    const category = classification?.category ?? "unreadable";
    const confidence = classification === undefined ? "-" : classification.confidence.toFixed(2);
    const source = classification?.source ?? "-";
    const flag = reviewReason === undefined ? "" : ` review:${reviewReason}`;

    return `  ${String(index + 1).padStart(3)}  ${when}  ${category.padEnd(13)}${confidence.padEnd(6)}${source.padEnd(6)}${flag}`;
  });

  return [
    "redacted report: decisions only, no subjects, senders or reasons",
    `  row  received          category     conf  by`,
    ...rows,
    "",
    ...summary(pairings, model),
    "",
    closing(applying),
  ];
}

/** The last line of every report, and the one a user is most likely to quote back. */
function closing(applying: boolean): string {
  return applying
    ? "Applying this now. Reverse all of it with: cleamail undo --last"
    : "Nothing in your mailbox was changed.";
}

function section(heading: string, body: readonly string[]): readonly string[] {
  if (body.length === 0) return [];

  return [heading, ...body, ""];
}

/** One email per entry, with the reason, because this is the list a user checks for mistakes. */
function detailed(pairings: readonly Pairing[]): readonly string[] {
  return pairings.flatMap(({ email, outcome, decision }) => {
    const category = outcome.classification?.category ?? "unclassified";

    return [
      `  ${category.padEnd(13)}${plain(email.subject)}`,
      `  ${" ".repeat(13)}${senderOf(email)}`,
      // The engine's sentence rather than the classification's own, so an email the model could not
      // classify says why in cleamail's words instead of leaving the row unexplained.
      `  ${" ".repeat(13)}${plain(explainDecision(decision), 70)}`,
    ];
  });
}

function reviewLines(pairings: readonly Pairing[]): readonly string[] {
  return pairings.flatMap(({ email, outcome, decision }) => {
    const why = REVIEW_LABELS[outcome.reviewReason ?? ""] ?? "needs a look";
    const category = outcome.classification?.category;
    const suffix = category === undefined ? "" : ` (looked like ${category})`;

    return [
      `  ${why.padEnd(22)}${plain(email.subject)}`,
      `  ${" ".repeat(22)}${senderOf(email)}${suffix}`,
      // When there is no classification there is nothing else to show, so the engine's sentence
      // goes here. The eval report has said why since SPEC-010; "model output invalid" on its own
      // leaves a user with nothing to do about it.
      ...(category === undefined
        ? [`  ${" ".repeat(22)}${plain(explainDecision(decision), 70)}`]
        : []),
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
