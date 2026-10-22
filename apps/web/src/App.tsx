import { useMemo } from "react";
import type { ApiDecision } from "./api.js";
import { Applied, Undone } from "./components/changed.js";
import { DecisionRow } from "./components/decision-row.js";
import { Preview } from "./components/preview.js";
import { StatusBar } from "./components/status-bar.js";
import { Empty, Failed, ListPanel, Loading, Panel } from "./components/states.js";
import { plural } from "./format.js";
import {
  group,
  useApplyRun,
  useAudit,
  useDecisions,
  useEmails,
  useStatus,
  useUndo,
} from "./queries.js";

/**
 * The dashboard.
 *
 * It renders what the API says and asks for apply or undo. Nothing here decides what an email is
 * or what should happen to it: that is the policy engine's job, and a second opinion in the browser
 * would be a second answer to the only question that matters.
 */
export function App({ now = new Date() }: { now?: Date }) {
  const status = useStatus();
  const decisions = useDecisions();
  const audit = useAudit();
  const apply = useApplyRun();
  const undo = useUndo();

  const grouped = useMemo(() => group(decisions.data ?? []), [decisions.data]);

  const ids = useMemo(() => {
    const everything: ApiDecision[] = [
      ...(grouped.preview?.decisions ?? []),
      ...grouped.needsAttention,
      ...grouped.review,
      ...grouped.cleaned,
    ];

    return [...new Set(everything.map((decision) => decision.emailId))];
  }, [grouped]);

  const emails = useEmails(ids);

  /** The one query behind every list, so each panel can say which state it is in. */
  const listState = (isEmpty: boolean) => ({
    isPending: decisions.isPending,
    isError: decisions.isError,
    error: decisions.error,
    isEmpty,
  });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <StatusBar status={status.data} />

      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
        {status.isError ? <Failed what="the local service" error={status.error} /> : null}

        {apply.data === undefined ? null : <Applied result={apply.data} />}
        {undo.data === undefined ? null : <Undone result={undo.data} />}

        {decisions.isPending ? (
          <Panel title="Waiting for you">
            <Loading what="what cleamail decided" />
          </Panel>
        ) : decisions.isError ? (
          <Panel title="Waiting for you">
            <Failed what="the decisions" error={decisions.error} />
          </Panel>
        ) : grouped.preview === undefined ? (
          <Panel title="Waiting for you">
            <Empty>
              Nothing is waiting. Run{" "}
              <code className="rounded bg-slate-100 px-1">cleamail run</code> in a terminal to look
              at the last 7 days, and the preview will appear here.
            </Empty>
          </Panel>
        ) : (
          <Preview
            runId={grouped.preview.runId}
            decisions={grouped.preview.decisions}
            emails={emails.data}
            status={status.data}
            now={now}
            applying={apply.isPending}
            error={apply.error}
            onApprove={(runId) => {
              apply.mutate(runId);
            }}
          />
        )}

        <ListPanel
          title="Needs attention"
          state={listState(grouped.needsAttention.length === 0)}
          what="what needs you"
          empty="Nothing in the inbox needs you right now."
        >
          <ul>
            {grouped.needsAttention.map((decision) => (
              <DecisionRow
                key={decision.id}
                decision={decision}
                email={emails.data?.get(decision.emailId)}
                now={now}
              />
            ))}
          </ul>
        </ListPanel>

        {decisions.isSuccess && grouped.review.length === 0 ? null : (
          <ListPanel
            title="cleamail was unsure"
            state={listState(grouped.review.length === 0)}
            what="the review list"
            empty="Nothing needed a second look."
          >
            <ul>
              {grouped.review.map((decision) => (
                <DecisionRow
                  key={decision.id}
                  decision={decision}
                  email={emails.data?.get(decision.emailId)}
                  now={now}
                />
              ))}
            </ul>
          </ListPanel>
        )}

        <ListPanel
          title="Cleaned"
          state={listState(grouped.cleaned.length === 0)}
          what="what was cleaned"
          empty="Nothing has been cleaned yet."
          action={
            grouped.cleaned.length === 0 ? undefined : (
              <button
                type="button"
                className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                disabled={undo.isPending}
                onClick={() => {
                  undo.mutate({});
                }}
              >
                {undo.isPending ? "Undoing..." : "Undo the last run"}
              </button>
            )
          }
        >
          <>
            {undo.error === null ? null : (
              <p className="mb-2 text-sm text-rose-700" role="alert">
                {undo.error instanceof Error ? undo.error.message : "That could not be undone."}
              </p>
            )}
            <p className="pb-2 text-sm text-slate-600">
              {plural(grouped.cleaned.length, "email", "emails")} out of the inbox, each with the
              reason cleamail had.
            </p>
            <ul>
              {grouped.cleaned.map((decision) => (
                <DecisionRow
                  key={decision.id}
                  decision={decision}
                  email={emails.data?.get(decision.emailId)}
                  now={now}
                  undoing={undo.isPending}
                  onUndo={(emailId) => {
                    undo.mutate({ runId: decision.runId, emailId });
                  }}
                />
              ))}
            </ul>
          </>
        </ListPanel>

        <ListPanel
          title="What cleamail did"
          state={{
            isPending: audit.isPending,
            isError: audit.isError,
            error: audit.error,
            isEmpty: (audit.data ?? []).length === 0,
          }}
          what="the log"
          empty="Nothing yet."
        >
          <ul className="text-sm text-slate-600">
            {audit.data?.map((entry) => (
              <li key={entry.id} className="border-b border-slate-100 py-2 last:border-b-0">
                {entry.summary}
              </li>
            ))}
          </ul>
        </ListPanel>
      </main>
    </div>
  );
}
