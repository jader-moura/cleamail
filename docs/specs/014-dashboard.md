# SPEC-014: React dashboard with the first-run preview

- Phase: v0.1 - 3. Act safely
- Status: done

## Goal

The screen people actually live in. It shows what cleamail thinks of the last run, lets the user
approve it before anything touches the inbox, and puts undo one click away. The terminal stops being
the product here.

## Scope

- `apps/web`: React + Vite + TanStack Query + Tailwind, every asset bundled locally.
- `apps/server`: the mail summaries the lists need, applying a preview, and serving the built app
  from the same origin.
- Nothing about settings or corrections, which are SPEC-016 and SPEC-017.

## Decisions

- **The API serves subjects and senders, on a route of their own.** SPEC-013 claimed a view wanting
  a subject should read the store directly, which cannot work: the dashboard is a browser app and
  cannot open SQLite. Loopback HTTP to the user's own browser never leaves the machine, so this is
  the same promise kept the same way. Mail lives in `/api/emails`, apart from the decision shapes,
  so the routes that only report what happened still cannot ship an inbox.
- **Approving a preview applies the decisions that were already recorded.** `cleamail run` writes a
  dry run; `POST /api/apply` takes that run's id and hands those same decisions to the executor,
  which is the one code path that changes a mailbox. The server still classifies nothing and plans
  nothing, and the user approves exactly what they were shown.
- **Fetching and classifying stay out of the browser.** The dashboard cannot start a run, because
  that needs the model and the provider and belongs with the scheduler in SPEC-015. Until then the
  empty state says which command produces a preview, rather than offering a button that would sit
  there spinning for two minutes.
- **Every asset is in the bundle.** No CDN, no Google Fonts, no analytics, no source map fetched
  from anywhere. The font stack is the one already on the machine. A test scans the built output for
  an external URL, so this cannot regress quietly.
- **The dashboard never computes a decision.** It renders what the API says and asks for undo or
  apply. Nothing in the browser decides what an email is or what should happen to it, which is the
  same rule the server follows and the reason both are safe to leave running.
- **Mail is shown with its reason next to it, always.** A list of archived mail with no reasons is
  what makes a user distrust a tool like this. Subject, sender, category, confidence and the
  sentence, on one row each.
- **The whole app works without JavaScript's optimism.** Loading, empty and error states are written
  for every query rather than left to a spinner, because the first thing a new user sees is usually
  an empty database or an unconnected mailbox.
- **Two dependencies beyond React.** TanStack Query for server state, named in the architecture, and
  Tailwind for styling. `@fastify/static` serves the built app, because hand-rolling static file
  serving is how path traversal bugs happen.

## Out of scope

- Starting a run from the browser, the background service, and notifications (SPEC-015).
- Settings, thresholds, the allowlist and the trash rule (SPEC-016).
- The correction button that teaches the agent (SPEC-017).
- Playwright end-to-end tests. The flows CLAUDE.md lists for them span the correction and trash-rule
  specs, so they land once those exist rather than being written twice.

## What building it showed

Running the built server against a seeded database found something no test with a fake would have:
`GET /api/decisions` asked for a provider it never used, so a machine with an account in the store
but no OAuth client in the keychain answered every read with "No Google OAuth client is stored".
Reading what cleamail decided needs an account id and nothing else. The dependency is split now,
`account()` for the reads and `connect()` for the two routes that change something, and a test
stands in for that half-finished setup.

The same run turned up a second thing. `canModify` was computed as
`capabilities.ok && capabilities.value.canModify`, which reports "read-only" when the truth is
"cleamail could not find out". Those need different sentences, because "re-run init without
--read-only" is the wrong advice for a keychain with no client in it. The field is optional now:
present and true, present and false, or absent, and the dashboard says something different for each.

Two smaller ones, both in the tests rather than the app. Testing Library's automatic cleanup only
registers itself when vitest runs with globals, which this workspace does not, so every render was
staying in the document and the next test found two of everything. And the bundle check has to run
in the node environment, because a real build runs esbuild and esbuild's `TextEncoder` invariant
fails inside jsdom.

Auditing the acceptance list afterwards caught three more, which is the point of writing one. Every
panel except the preview rendered its empty state while the request was still in flight, so a
loading mailbox said "nothing in the inbox needs you right now", and on failure said the same. They
follow the query behind them now, through one `ListPanel`. Approving and undoing refreshed the lists
but said nothing about what had happened, and threw away the per-email failures the executor
reports, so both now print what changed and name anything that could not be done. And the dev script
claimed a watch mode the server does not have; the docs say what actually happens instead.

Opening the thing in a real browser found what neither the unit tests nor the API tests could. A
first run rendered as "Approving will clear 0 emails out of the inbox", with every row saying "Left
alone", because the API built its action list from the action rows and a dry run deliberately writes
none: the plan lives on the decision. Both sides of that were tested and both were consistent with
each other, which is how a gap like this survives. The mapper falls back to the decision's own plan
now, as `planned` actions with negative ids so nothing can mistake one for a row undo could act on.
The same look also caught "leave 1 email where they are".

## Acceptance

- `GET /api/emails` returns subject, sender, date and state for the ids asked for, and nothing else.
- `POST /api/apply` applies a recorded dry run through the executor and refuses a run that was
  already applied.
- The dashboard lists what needs attention and what would be cleaned, each row with its reason.
- The preview can be approved, and after approving, the page shows what changed.
- Undo is one click, and the page reflects the result without a reload.
- Every list has a written loading, empty and error state.
- The built bundle contains no external URL, and a test proves it.
- The server serves the app from the same origin, with the `Host` check and no CORS header.
