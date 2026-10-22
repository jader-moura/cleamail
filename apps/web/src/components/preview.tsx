import { useState } from "react";
import type { ApiDecision, ApiEmail, ApiStatus } from "../api.js";
import { plural } from "../format.js";
import { DecisionRow } from "./decision-row.js";
import { Panel } from "./states.js";

/**
 * The first-run preview: what cleamail would do, and the one button that lets it.
 *
 * Nothing is applied until this is approved, and what gets applied is exactly these decisions,
 * planned when the preview was recorded. The counts are spelled out above the button because
 * "approve" has to mean something specific.
 */
export function Preview({
  runId,
  decisions,
  emails,
  status,
  now,
  onApprove,
  applying,
  error,
}: {
  runId: string;
  decisions: readonly ApiDecision[];
  emails: Map<string, ApiEmail> | undefined;
  status: ApiStatus | undefined;
  now: Date;
  onApprove: (runId: string) => void;
  applying: boolean;
  error: unknown;
}) {
  const [expanded, setExpanded] = useState(false);

  const removing = decisions.filter((decision) =>
    decision.actions.some((action) => action.type === "archive" || action.type === "trash"),
  );
  const keeping = decisions.length - removing.length;
  // Unknown is not permission: the button stays off until the API says the mailbox may change.
  const canAct = status?.mailbox?.canModify === true;
  const shown = expanded ? decisions : decisions.slice(0, 5);

  return (
    <Panel
      title="Waiting for you"
      action={
        <button
          type="button"
          className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          disabled={applying || !canAct}
          onClick={() => {
            onApprove(runId);
          }}
        >
          {applying ? "Applying..." : "Approve and apply"}
        </button>
      }
    >
      <p className="text-sm text-slate-700">
        cleamail went through {plural(decisions.length, "email", "emails")} and nothing has been
        changed yet. Approving will clear {plural(removing.length, "email", "emails")} out of the
        inbox and leave {plural(keeping, "email", "emails")}{" "}
        {keeping === 1 ? "where it is" : "where they are"}.
      </p>
      {canAct ? null : (
        <p className="mt-2 text-sm text-amber-800">
          cleamail cannot change this mailbox, so there is nothing to approve yet.
        </p>
      )}
      {error === null || error === undefined ? null : (
        <p className="mt-2 text-sm text-rose-700" role="alert">
          {error instanceof Error ? error.message : "The local service could not apply that."}
        </p>
      )}
      <ul className="mt-3">
        {shown.map((decision) => (
          <DecisionRow
            key={decision.id}
            decision={decision}
            email={emails?.get(decision.emailId)}
            now={now}
          />
        ))}
      </ul>
      {decisions.length > shown.length || expanded ? (
        <button
          type="button"
          className="mt-2 text-xs font-medium text-slate-600 underline"
          onClick={() => {
            setExpanded((value) => !value);
          }}
        >
          {expanded ? "Show fewer" : `Show all ${String(decisions.length)}`}
        </button>
      ) : null}
    </Panel>
  );
}
