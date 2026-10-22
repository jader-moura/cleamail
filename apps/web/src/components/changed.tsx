import type { ApiApplyResult, ApiUndoResult } from "../api.js";
import { plural } from "../format.js";

/**
 * What just happened, said out loud.
 *
 * The lists refresh on their own, but "the archive list grew" is not the same as being told what
 * was done. This is also the only place a per-email failure is visible: the run carries on past
 * one, so without this the user would never learn which message was left alone.
 */
export function Applied({ result }: { result: ApiApplyResult }) {
  return (
    <div
      className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm"
      role="status"
    >
      <p className="font-medium text-emerald-900">
        Applied {plural(result.applied, "change", "changes")} to{" "}
        {plural(result.emailsChanged, "email", "emails")}.
      </p>
      {result.skipped === 0 ? null : (
        <p className="mt-1 text-emerald-800">
          {plural(result.skipped, "change", "changes")} were already true, so they were left alone.
        </p>
      )}
      <Failures failures={result.failures} what="changed" />
      <p className="mt-1 text-emerald-800">Undo is below, on the run and on each email.</p>
    </div>
  );
}

export function Undone({ result }: { result: ApiUndoResult }) {
  return (
    <div className="rounded border border-slate-300 bg-slate-100 px-3 py-2 text-sm" role="status">
      <p className="font-medium text-slate-900">
        {result.reversed === 0
          ? "Nothing to undo: that run had already been put back."
          : `Put ${plural(result.emailsRestored, "email", "emails")} back, undoing ${plural(
              result.reversed,
              "change",
              "changes",
            )}.`}
      </p>
      {result.alreadyReversed === 0 || result.reversed === 0 ? null : (
        <p className="mt-1 text-slate-700">
          {plural(result.alreadyReversed, "change", "changes")} had been undone before.
        </p>
      )}
      <Failures failures={result.failures} what="put back" />
    </div>
  );
}

/** `what` is the past participle, so the sentence reads as one: "could not be changed". */
function Failures({
  failures,
  what,
}: {
  failures: readonly { emailId: string; error: string }[];
  what: string;
}) {
  if (failures.length === 0) return null;

  return (
    <div className="mt-1 text-rose-800">
      <p>
        {plural(failures.length, "email", "emails")} could not be {what}:
      </p>
      <ul className="mt-1 list-inside list-disc">
        {failures.map((failure) => (
          <li key={failure.emailId}>
            <span className="font-mono text-xs">{failure.emailId}</span>: {failure.error}
          </li>
        ))}
      </ul>
    </div>
  );
}
