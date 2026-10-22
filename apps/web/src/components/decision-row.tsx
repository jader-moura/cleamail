import type { ApiDecision, ApiEmail } from "../api.js";
import { actionLabel, categoryLabel, reviewLabel, senderLabel, timeAgo } from "../format.js";

const CATEGORY_TONE: Readonly<Record<string, string>> = {
  important: "bg-amber-100 text-amber-900",
  needs_reply: "bg-amber-100 text-amber-900",
  suspicious: "bg-rose-100 text-rose-900",
  fyi: "bg-slate-100 text-slate-700",
  newsletter: "bg-sky-100 text-sky-900",
  promotion: "bg-sky-100 text-sky-900",
  notification: "bg-sky-100 text-sky-900",
};

/**
 * One decision, with the mail it is about and the reason for it.
 *
 * The reason is never optional furniture. A list of archived mail without reasons is what makes a
 * user stop trusting a tool like this, so the sentence is part of the row.
 */
export function DecisionRow({
  decision,
  email,
  now,
  onUndo,
  undoing,
}: {
  decision: ApiDecision;
  email: ApiEmail | undefined;
  now: Date;
  onUndo?: (emailId: string) => void;
  undoing?: boolean;
}) {
  const tone = CATEGORY_TONE[decision.category ?? ""] ?? "bg-slate-100 text-slate-700";
  const reversible = decision.actions.some((action) => action.reversible);

  return (
    <li className="border-b border-slate-100 py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${tone}`}>
              {categoryLabel(decision.category)}
            </span>
            <p className="truncate text-sm font-medium text-slate-900">
              {email?.subject === undefined || email.subject.trim() === ""
                ? "(no subject)"
                : email.subject}
            </p>
          </div>
          <p className="mt-1 truncate text-xs text-slate-500">
            {senderLabel(email)}
            {email === undefined ? "" : ` - ${timeAgo(email.receivedAt, now)}`}
          </p>
          <p className="mt-1 text-sm text-slate-600">{decision.explanation}</p>
          {decision.reviewReason === undefined ? null : (
            <p className="mt-1 text-xs text-amber-800">
              Waiting for you because {reviewLabel(decision.reviewReason)}.
            </p>
          )}
          <p className="mt-1 text-xs text-slate-400">
            {decision.actions.length === 0
              ? "Left alone."
              : decision.actions
                  .map(
                    (action) =>
                      `${actionLabel(action.type)}${action.outcome === "skipped" ? " (already true)" : ""}`,
                  )
                  .join(", ")}
          </p>
        </div>
        {onUndo === undefined ? null : (
          <button
            type="button"
            className="shrink-0 rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            disabled={undoing === true || !reversible}
            onClick={() => {
              onUndo(decision.emailId);
            }}
          >
            {reversible ? "Undo" : "Undone"}
          </button>
        )}
      </div>
    </li>
  );
}
