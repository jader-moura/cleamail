import type { EvalRun } from "./runner.js";
import type { CategoryMetrics, ConfusionRow } from "./metrics.js";

/**
 * The roadmap's phase-4 gate: under 1% of the set may be a dangerous miss.
 *
 * Read strictly. A run that lands exactly on 1% has not met a target of "under 1%", and rounding
 * that in cleamail's favour is the one place rounding must never happen.
 */
export const DANGEROUS_TARGET = 0.01;

/**
 * True when the rate meets the target, which means strictly under it.
 *
 * A run with no dangerous misses at all meets any target, including zero. Everything else has to be
 * under the number, so a rate that lands exactly on it fails.
 */
export function meetsDangerousTarget(rate: number, target: number = DANGEROUS_TARGET): boolean {
  return rate === 0 || rate < target;
}

export type ReportOptions = {
  readonly dangerousTarget?: number;
  /** How many dangerous or violating case ids to list before summarizing the rest. */
  readonly maxListed?: number;
};

const DEFAULT_MAX_LISTED = 12;

/**
 * Formats a run as lines of text.
 *
 * Pure, like the dry-run report in the CLI, so the layout is unit tested rather than eyeballed.
 * Safety comes before accuracy here on purpose: a reader who stops after the first screen should
 * have seen the number that decides whether this version is safe to let near an inbox.
 */
export function formatEvalReport(run: EvalRun, options: ReportOptions = {}): readonly string[] {
  const target = options.dangerousTarget ?? DANGEROUS_TARGET;
  const maxListed = options.maxListed ?? DEFAULT_MAX_LISTED;
  const { metrics } = run;

  const lines: string[] = [
    "cleamail eval",
    "",
    `  model       ${run.model}`,
    `  cases       ${String(metrics.total)} from ${String(metrics.scenarios)} scenario(s)`,
    `  threshold   ${run.settings.confidenceThreshold.toFixed(2)}`,
    // Without this line the safety number is unreadable: label-only mode never removes anything
    // from an inbox, so it scores a perfect zero for free.
    `  archiving   ${run.settings.archiveCleaned ? "on" : "off, so nothing is ever removed"}`,
    "",
    "Safety",
    "",
    `  dangerous misses      ${count(metrics.dangerous.length, metrics.total)}   target under ${pct(
      target,
    )}`,
  ];

  lines.push(...ids(metrics.dangerous, maxListed));

  lines.push(`  must-not violations   ${count(metrics.mustNotViolations.length, metrics.total)}`);
  lines.push(...ids(metrics.mustNotViolations, maxListed));

  lines.push(`  over-cleaned fyi      ${count(metrics.overCleaned.length, metrics.total)}`);
  lines.push(...ids(metrics.overCleaned, maxListed));

  lines.push(
    "",
    meetsDangerousTarget(metrics.dangerousRate, target)
      ? "  Within the target."
      : "  Not under the target. Nothing should act on an inbox at this rate.",
    "",
    "Accuracy",
    "",
    `  exact          ${count(metrics.exact, metrics.total)}`,
    `  acceptable     ${count(metrics.acceptable, metrics.total)}`,
    `  wrong          ${count(metrics.wrong, metrics.total)}`,
    `  unclassified   ${count(metrics.unclassified, metrics.total)}`,
    `  correct        ${count(metrics.exact + metrics.acceptable, metrics.total)}`,
  );

  lines.push(...reasons(metrics.unclassifiedReasons));

  lines.push(
    "",
    "Routing",
    "",
    `  settled by rules   ${count(metrics.settledByRule, metrics.total)}`,
    `  settled by model   ${count(metrics.settledByModel, metrics.total)}`,
    `  sent to review     ${count(metrics.reviewed, metrics.total)}`,
    "",
    "Per category",
    "",
    "  category      support  predicted  precision  recall     f1",
  );

  for (const category of metrics.categories) {
    lines.push(categoryLine(category));
  }

  lines.push("", "Confusion, by true category", "");

  for (const row of metrics.confusion) {
    lines.push(confusionLine(row));
  }

  lines.push(
    "",
    "Latency",
    "",
    `  mean   ${duration(metrics.latency.meanMs)}`,
    `  p50    ${duration(metrics.latency.p50Ms)}`,
    `  p95    ${duration(metrics.latency.p95Ms)}`,
    `  max    ${duration(metrics.latency.maxMs)}`,
    `  total  ${duration(metrics.latency.totalMs)}`,
  );

  return lines;
}

/**
 * What the unclassified cases failed on.
 *
 * Sorted by how often, because when a whole run fails it almost always fails the same way, and that
 * one line is the answer.
 */
function reasons(counts: ReadonlyMap<string, number>): readonly string[] {
  if (counts.size === 0) return [];

  return [
    "",
    "  Why cases could not be classified",
    ...[...counts.entries()]
      .sort(([leftReason, left], [rightReason, right]) =>
        right === left ? leftReason.localeCompare(rightReason) : right - left,
      )
      .map(([reason, value]) => `    ${padLeft(String(value), 4)}  ${reason}`),
  ];
}

function categoryLine(metrics: CategoryMetrics): string {
  return [
    `  ${padRight(metrics.category, 12)}`,
    padLeft(String(metrics.support), 7),
    padLeft(String(metrics.predicted), 11),
    padLeft(ratio(metrics.precision), 11),
    padLeft(ratio(metrics.recall), 8),
    padLeft(ratio(metrics.f1), 7),
  ].join("");
}

function confusionLine(row: ConfusionRow): string {
  const predictions = [...row.predicted.entries()]
    .sort(([leftCategory, left], [rightCategory, right]) =>
      right === left ? leftCategory.localeCompare(rightCategory) : right - left,
    )
    .map(([category, value]) => `${category} ${String(value)}`);

  if (row.unclassified > 0) predictions.push(`none ${String(row.unclassified)}`);

  const answers = predictions.length === 0 ? "no cases" : predictions.join(", ");

  return `  ${padRight(row.expected, 12)}-> ${answers}`;
}

/** `12  4.0%`, so a count and its share read as one thing. */
function count(part: number, whole: number): string {
  return `${padLeft(String(part), 4)}  ${padLeft(pct(whole === 0 ? 0 : part / whole), 6)}`;
}

function ids(values: readonly string[], maxListed: number): readonly string[] {
  if (values.length === 0) return [];

  const listed = values.slice(0, maxListed).map((value) => `      ${value}`);
  const hidden = values.length - Math.min(values.length, maxListed);

  return hidden === 0 ? listed : [...listed, `      and ${String(hidden)} more`];
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function ratio(value: number | undefined): string {
  return value === undefined ? "-" : value.toFixed(3);
}

function duration(ms: number): string {
  if (ms < 1000) return `${String(Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;

  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);

  return `${String(minutes)}m ${String(seconds)}s`;
}

function padLeft(value: string, width: number): string {
  return value.length >= width ? value : " ".repeat(width - value.length) + value;
}

function padRight(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}
