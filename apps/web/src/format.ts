/** Small pure helpers for the row text. Pure so the wording is unit tested, not eyeballed. */

const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  important: "Important",
  needs_reply: "Needs reply",
  fyi: "FYI",
  newsletter: "Newsletter",
  promotion: "Promotion",
  notification: "Notification",
  suspicious: "Suspicious",
};

export function categoryLabel(category: string | undefined): string {
  return category === undefined ? "Unreadable" : (CATEGORY_LABELS[category] ?? category);
}

const REVIEW_LABELS: Readonly<Record<string, string>> = {
  low_confidence: "cleamail was not sure",
  invalid_model_output: "the model's answer could not be used",
  suspicious: "it looks like a forgery",
};

export function reviewLabel(reason: string | undefined): string {
  return reason === undefined ? "needs a look" : (REVIEW_LABELS[reason] ?? "needs a look");
}

/** The sender as a person reads it: the name when there is one, the address when there is not. */
export function senderLabel(email: { from: string; fromName?: string } | undefined): string {
  if (email === undefined) return "unknown sender";

  return email.fromName === undefined || email.fromName.trim() === ""
    ? email.from
    : `${email.fromName} <${email.from}>`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long ago, in words.
 *
 * `now` is passed in rather than read, so the text is a function of its inputs and a test does not
 * have to freeze a clock to assert on it.
 */
export function timeAgo(iso: string, now: Date): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "at an unknown time";

  const elapsed = now.getTime() - then;
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${String(Math.floor(elapsed / MINUTE))}m ago`;
  if (elapsed < DAY) return `${String(Math.floor(elapsed / HOUR))}h ago`;

  const days = Math.floor(elapsed / DAY);

  return days === 1 ? "yesterday" : `${String(days)}d ago`;
}

/** "3 emails", "1 email": a count the sentence can be built around. */
export function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** What an action would do, in the user's words rather than the domain's. */
export function actionLabel(type: string): string {
  switch (type) {
    case "label":
      return "label it";
    case "star":
      return "star it";
    case "archive":
      return "archive it";
    case "mark_read":
      return "mark it read";
    case "trash":
      return "move it to Trash";
    default:
      return type;
  }
}
