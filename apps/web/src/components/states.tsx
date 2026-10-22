import type { ReactNode } from "react";

/**
 * Loading, empty and error, written out.
 *
 * Every list on this page uses these rather than a spinner. The first thing a new user sees is an
 * empty database or an unconnected mailbox, and "nothing here" has to say which one it is.
 */

export function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between gap-4 border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold tracking-wide text-slate-700 uppercase">{title}</h2>
        {action}
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

export function Loading({ what }: { what: string }) {
  return (
    <p className="py-6 text-center text-sm text-slate-500" role="status">
      Reading {what}...
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-slate-500">{children}</p>;
}

export function Failed({ what, error }: { what: string; error: unknown }) {
  const message = error instanceof Error ? error.message : "Something went wrong.";

  return (
    <div className="py-4 text-sm" role="alert">
      <p className="font-medium text-rose-700">Could not load {what}.</p>
      <p className="mt-1 text-slate-600">{message}</p>
      <p className="mt-2 text-slate-500">
        cleamail runs on your machine, so this is usually the local service being stopped. Start it
        again with <code className="rounded bg-slate-100 px-1">cleamail start</code>.
      </p>
    </div>
  );
}

/**
 * A panel whose body follows the query behind it.
 *
 * Written once because the alternative is what this page had first: panels that rendered "nothing
 * here" while the request was still in flight, which is a lie about someone's mailbox told in the
 * calmest possible voice.
 */
export function ListPanel({
  title,
  action,
  state,
  what,
  empty,
  children,
}: {
  title: string;
  action?: ReactNode;
  state: { isPending: boolean; isError: boolean; error: unknown; isEmpty: boolean };
  what: string;
  empty: ReactNode;
  children: ReactNode;
}) {
  return (
    <Panel title={title} {...(action === undefined ? {} : { action })}>
      {state.isPending ? (
        <Loading what={what} />
      ) : state.isError ? (
        <Failed what={what} error={state.error} />
      ) : state.isEmpty ? (
        <Empty>{empty}</Empty>
      ) : (
        children
      )}
    </Panel>
  );
}
