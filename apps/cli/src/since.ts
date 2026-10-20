import { failure, ok, type Result } from "@cleamail/core";

const RELATIVE = /^(\d+)([dh])$/;

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Parses `--since`: `7d`, `24h` or an ISO date.
 *
 * A value it cannot read is an error rather than a default, because silently falling back to a
 * different window would quietly change what a dry run reports on.
 */
export function parseSince(value: string, now: Date): Result<Date> {
  const trimmed = value.trim();

  if (trimmed === "") return failure("config_invalid", "--since needs a value, such as 7d.");

  const relative = RELATIVE.exec(trimmed);
  if (relative !== null) {
    const amount = Number.parseInt(relative[1] ?? "0", 10);
    if (amount <= 0) return failure("config_invalid", "--since must be more than zero.");

    const unit = relative[2] === "d" ? MS_PER_DAY : MS_PER_HOUR;

    return ok(new Date(now.getTime() - amount * unit));
  }

  const absolute = new Date(trimmed);
  if (Number.isNaN(absolute.getTime())) {
    return failure("config_invalid", `Could not read "${value}" as a date. Try 7d, 24h or a date.`);
  }

  return ok(absolute);
}

/** "3 days ago" style text for the run summary. */
export function describeWindow(since: Date, now: Date): string {
  const hours = Math.max(1, Math.round((now.getTime() - since.getTime()) / MS_PER_HOUR));

  if (hours < 48) return `the last ${hours} hour${hours === 1 ? "" : "s"}`;

  return `the last ${Math.round(hours / 24)} days`;
}
