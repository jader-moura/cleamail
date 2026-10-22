# SPEC-013: Local server on 127.0.0.1 with a local API

- Phase: v0.1 - 3. Act safely
- Status: done

## Goal

A small Fastify server on loopback that reads what the CLI has already written and offers the one
action a dashboard needs today: undo. It is the seam the React app in SPEC-014 is built on, and it
must be impossible to reach from anywhere but this machine.

## Scope

- `apps/server`: the Fastify app, the routes, and the binary that starts it.
- Request validation with Zod at the edge, like every other external input.
- `packages/store`: `busy_timeout`, because a second process now shares the database.
- Nothing in the web app, which is SPEC-014.

## Decisions

- **Loopback only, and asserted rather than configured.** `listen` is called with `127.0.0.1`, never
  `0.0.0.0`, and a test reads the bound address back. A local-first product that quietly listens on
  a laptop's wifi address at a coffee shop would have broken its own promise.
- **The `Host` header is checked on every request.** Loopback binding alone does not stop a web page
  the user is visiting from resolving its own hostname to 127.0.0.1 and talking to this server from
  the browser. Requests whose `Host` is not `localhost` or `127.0.0.1` on the server's own port are
  refused. This is the one attack a local server actually faces.
- **No CORS headers, ever.** The dashboard is served from the same origin in SPEC-014, so nothing
  legitimate needs them, and a permissive header here would hand any page the user visits a read of
  their mailbox.
- **The server plans nothing and classifies nothing.** It reads decisions and the audit log, and it
  calls the executor's undo. Fetching and classifying stay in the CLI until the scheduler in
  SPEC-015, so there is exactly one code path that decides what happens to an email.
- **Every response is built from a mapper, not from a row.** The API shape is a decision, not a side
  effect of the schema, and a column added later must not appear in the API because nobody stopped
  it.
- **A decision shape carries no mail.** The subject and the sender belong to a separate shape on a
  separate route, added in SPEC-014 for the lists that show mail. Keeping them apart means the
  routes that only report what happened cannot accidentally ship an inbox.
- **Request logging holds ids and counts, never content.** The access log records method, path,
  status and duration. Query strings may carry an email id, which is allowed; nothing writes a
  subject, a sender or a reason into a log line.
- **Errors answer in the same shape as everything else.** `{ error: { code, message } }`, with the
  domain error's code, so the dashboard can tell "nothing to undo" from "the mailbox is read-only"
  without parsing prose.
- **One dependency, Fastify.** Named in the architecture, small, no telemetry, and its plugin
  surface is not needed here: no CORS plugin, no static plugin yet, no auth plugin.

## Out of scope

- Serving the built web app and the first-run preview (SPEC-014).
- The background scheduler and `cleamail start` (SPEC-015).
- Triggering a fetch or a run over HTTP. Until the scheduler exists, a run is a terminal command.
- Authentication beyond the loopback and `Host` checks. A token belongs with the desktop app in
  v0.2, when something other than the user's own browser can reach the server.
- Settings writes, which arrive with the settings UI in SPEC-016.

## What building it showed

The `Host` check was wrong the first time in a way only a real socket could show. It compared the
port in the header against the port `listen` was asked for, which is not the port the server is on
when the operating system assigns one. Every request through a real socket came back 403. It now
reads the bound port out of the server and falls back to the configured one before the socket
exists, which is the only state `inject` ever sees.

`fetch` refuses to send a `Host` header, so the test that proves a foreign host is refused goes
through `node:http` instead. A browser pointed at a hostname that resolves to 127.0.0.1 sends
exactly what that test sends.

The privacy guard cannot be installed around a listening server: it blocks every live connection by
design, loopback included, and `listen` resolves its host through DNS. So the guard covers the
routes through `inject` and the app's own startup, and the socket is covered separately. That is the
honest division, and the comment in the test says so rather than leaving a weaker test looking like
a stronger one.

Two things found while checking the ground before writing any of it, both preconditions rather than
discoveries of this spec: the database had no `busy_timeout`, so the first write that collided with
another process would have failed instantly with `SQLITE_BUSY` rather than waiting the moment it
takes; and `tsconfig.build.json` excluded only `*.test.ts`, so every package shipped its test
helpers in `dist`.

## Acceptance

- The server binds `127.0.0.1` and the bound address is asserted in a test.
- A request with a foreign `Host` header is refused, and one from `localhost` or `127.0.0.1` is not.
- No response carries a CORS header.
- `GET /api/health` answers without a mailbox connected.
- `GET /api/status` reports the account, the counts, the model and whether the mailbox may be
  changed.
- `GET /api/decisions` returns the recorded decisions, newest first, with their actions.
- `GET /api/audit` returns the audit log, newest first.
- `POST /api/undo` reverses a run through the same executor the CLI uses, and says what it did.
- A bad query string or body is refused with a message naming the field, not a 500.
- The whole server runs under the privacy guard in a test and makes no outbound call.
