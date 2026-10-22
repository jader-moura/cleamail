import type { ApiStatus } from "../api.js";

/**
 * What cleamail is connected to, and what it is allowed to do.
 *
 * The read-only line is the important one: a user who connected with `--read-only` should learn it
 * here rather than from a button that refuses.
 */
export function StatusBar({ status }: { status: ApiStatus | undefined }) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-3xl flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3">
        <h1 className="text-lg font-semibold text-slate-900">cleamail</h1>
        <p className="text-sm text-slate-500">
          {status?.mailbox === undefined
            ? "no mailbox connected"
            : `${status.mailbox.address} - ${String(status.mailbox.messages)} stored`}
        </p>
        <p className="ml-auto text-xs text-slate-400">
          {status === undefined ? "" : `${status.model} - everything runs on this machine`}
        </p>
      </div>
      {status?.mailbox === undefined ? null : status.mailbox.canModify === false ? (
        <p className="bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">
          This mailbox is connected read-only, so cleamail can show you what it would do and change
          nothing. Run <code className="rounded bg-amber-100 px-1">cleamail init</code> again
          without --read-only to let it act.
        </p>
      ) : status.mailbox.canModify === undefined ? (
        <p className="bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">
          cleamail could not tell what this connection is allowed to do, so it will not offer to
          change anything. Run <code className="rounded bg-amber-100 px-1">cleamail status</code> to
          see what is missing.
        </p>
      ) : null}
    </header>
  );
}
