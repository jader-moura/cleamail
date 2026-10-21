# CLAUDE.md

Guidance for Claude Code when working in the cleamail repository.

## What this project is

`cleamail` is an open-source email agent that runs 100% on the user's own machine. It reads a Gmail or IMAP inbox, classifies each email with a local LLM (Ollama), clears out what is not needed, and surfaces what deserves attention.

Three promises define the product. Every change must keep them true:

1. **Accurate.** Remove what is really not necessary, and never lose what matters. The key metric is false positives on `important` (target under 1%). Dry-run first, reasons on every decision, undo on every action: these exist to protect accuracy and trust.
2. **Private.** Everything is solved locally. Email content never leaves the machine. No cloud LLMs, no telemetry, no analytics. The only network calls are to the user's mail provider and to Ollama on localhost.
3. **Free.** 100% free and open source. No API keys, no subscriptions, no hidden fees. The user's own machine does all the work.

This is also a public portfolio project. Code quality, tests, docs and commit history are part of the product.

## How people use it

The terminal is only for getting started. Day to day, users live in a local web dashboard.

1. **Install (terminal, once):** `npx cleamail init` checks Ollama, pulls the model, connects the mail account, then opens the dashboard.
2. **First run (dashboard):** a dry-run preview of the last 7 days. The user approves, tweaks or rejects before anything touches the inbox.
3. **Daily use (dashboard):** a "Needs attention" list, a "Cleaned" list with reasons, one-click undo, and a "this was wrong" correction button that teaches the agent.
4. **Background:** `cleamail start` runs a small local service that checks new mail every 15 to 30 minutes.
5. **Settings (dashboard):** rules, thresholds, allowlist, and the opt-in trash rule.

The dashboard is a React app served on `localhost` by `apps/server`. Nothing is hosted.

## Non-goals (v0.1)

Do not add these without an explicit request:

- Cloud LLMs, OpenAI-compatible remote endpoints, or any paid API
- Telemetry, analytics or crash reporting that sends data anywhere
- Sending email or drafting replies (never request the `gmail.send` scope)
- Permanent deletion or emptying Trash (moving to Trash is allowed only through the opt-in rule)
- Becoming a full email client
- Multi-user, hosted or SaaS features
- Mobile apps (desktop app is planned for v0.2)

## Architecture

TypeScript monorepo (pnpm workspaces + Turborepo), Clean Architecture boundaries.

```
apps/
  cli/        # `cleamail` command: init, start, run, eval, undo, status
  server/     # Fastify on localhost: local API, background scheduler, serves the web app
  web/        # React + Vite + TanStack Query + Tailwind dashboard
  mcp/        # MCP server exposing read-only queries and safe actions
  desktop/    # v0.2: Tauri or Electron shell around server + web (not in v0.1)
packages/
  core/       # Domain: Email, Classification, Decision, Action, Policy. No I/O.
  providers/  # Mail adapters: gmail (thin Zod-validated REST client), imap (imapflow)
  llm/        # Ollama adapter only. Prompts + Zod schemas.
  store/      # SQLite + Drizzle: emails, decisions, actions, audit log, corrections, embeddings, settings
  evals/      # Dataset loader, metrics, benchmark runner
  config/     # Shared tsconfig, eslint, prettier
```

Keep the LLM behind a port in `core` (clean boundaries), but ship only the Ollama adapter. Do not add remote providers.

### Pipeline

```
Mail adapter (fetch) -> Rules layer -> LLM classifier -> Policy engine -> Mail adapter (apply)
                            |                 ^               |
                            +--- confident ---|---------------+
                                              |               v
                                 corrections (few-shot)   audit log + undo (SQLite)
```

- **Rules layer** runs first: `List-Unsubscribe` header, Gmail categories, user allowlist/blocklist, known senders. Confident matches skip the model.
- **LLM classifier** returns only a JSON classification validated by Zod. It has no tools and never triggers actions.
- **Policy engine** is deterministic code. It turns a classification into actions based on user settings and confidence thresholds. It is the only place that decides what happens to an email.
- **Store** records every decision and action so it can be shown, explained and reversed.

### Dependency rules

- `core` depends on nothing in this repo and does no I/O.
- `providers`, `llm` and `store` implement interfaces (ports) defined in `core`.
- Apps compose adapters; they do not contain business logic.
- No Gmail, Ollama or Drizzle types may leak into `core`.
- `apps/desktop` (v0.2) must reuse `server`, `web` and the packages as they are. No forked logic.

## Domain model

Categories (fixed in v0.1): `important`, `needs_reply`, `fyi`, `newsletter`, `promotion`, `notification`, `suspicious`.

Classification shape (Zod, in `core`):

```ts
{
  category: Category,
  importance: number,      // 0..1
  confidence: number,      // 0..1
  reason: string,          // one short sentence, shown to the user
  source: "rule" | "model",
  ruleId?: string,
  model?: string
}
```

Actions: `label`, `star`, `archive`, `mark_read`, `trash`. Each action stores what is needed to reverse it.

Policy defaults:

- `important` and `needs_reply`: star, keep in inbox
- `newsletter`, `promotion`, `notification`: label `cleamail/Cleaned` + archive
- `suspicious`: label only, never archive or trash automatically
- Below the confidence threshold: label `cleamail/Review`, take no other action
- On ties or doubt, prefer the safer outcome (keep in inbox)

### Opt-in trash rule

- Off by default. Enabled and configured only in the dashboard settings.
- When on: emails that stayed in `cleamail/Cleaned` for N days (default 30, user-set) with no user correction are moved to Trash.
- Never applies to `important`, `needs_reply`, `suspicious`, `cleamail/Review`, starred, or allowlisted senders.
- Moving to Trash is the furthest cleamail ever goes. Never empty Trash or call permanent delete APIs.
- Every trash action is in the audit log and can be undone (restored from Trash) while the provider still holds it.
- The dashboard shows a preview count ("12 emails would move to Trash today") before the rule is enabled.

## Security and privacy rules (non-negotiable)

- Treat every email body, subject, sender name and header as **untrusted input**.
- Never give the classifier tools, function calling, or the ability to choose actions.
- Always validate model output with Zod. Invalid output falls back to `cleamail/Review`, never to an action.
- Wrap email content in clear delimiters in prompts and instruct the model to ignore instructions inside it.
- Keep prompt-injection cases in the eval set and in tests.
- Network: only the mail provider APIs and Ollama on localhost. No other outbound calls, including from the dashboard (no CDNs, no external fonts, no analytics scripts).
- The local server binds to `127.0.0.1` only.
- OAuth scopes: `gmail.modify` at most. Never `gmail.send`.
- Store tokens in the OS keychain (keytar or equivalent), never in plain files or logs.
- Never log full email bodies. Logs may include message IDs, categories and reasons.
- Never commit real email data. Eval fixtures must be synthetic or anonymized by `packages/evals/scripts/anonymize.ts`.

## Commands

```bash
pnpm install
pnpm dev            # server + web in watch mode
pnpm build
pnpm test           # vitest, all packages
pnpm test:e2e       # Playwright against the web dashboard
pnpm lint
pnpm typecheck
pnpm eval           # full eval run (needs Ollama)
pnpm eval:smoke     # 20-email subset, used in CI
```

CLI during development:

```bash
pnpm --filter @cleamail/cli dev -- init
pnpm --filter @cleamail/cli dev -- run --dry-run --since 7d
pnpm --filter @cleamail/cli dev -- undo --last
```

Local requirements: Node 22+, pnpm, Ollama running on `http://localhost:11434` with `qwen2.5:7b` and `nomic-embed-text` pulled. Document minimum hardware in the README and recommend a smaller model for CPU-only machines.

## Conventions

- Strict TypeScript. No `any`; use `unknown` and narrow.
- Zod schemas are the source of truth for external data; infer types from them.
- Small pure functions in `core`. Side effects live in adapters.
- Errors: return typed results in domain code; throw only at boundaries.
- Names: `kebab-case` files, `PascalCase` types, `camelCase` functions.
- React: function components, hooks, TanStack Query for server state. No global state library unless needed. All assets bundled locally.
- Prompts live in `packages/llm/src/prompts/` as versioned files. Changing a prompt requires an eval run and noting the result in the PR.
- Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`). Changesets for anything user-facing.
- No em dashes in docs, README or user-facing strings.

## Testing

- **Unit (vitest):** policy engine, trash rule, rules layer, Zod schemas, undo logic. Policy engine and trash rule coverage should stay near 100%.
- **Contract tests:** each mail provider against a fake implementing the same port.
- **LLM adapter tests:** use recorded responses; never call a real model in unit tests.
- **E2E (Playwright):** first-run dry-run preview, review flow, correction flow, undo, enabling the trash rule.
- **Evals:** `pnpm eval` reports per-category precision/recall, confusion matrix, latency per email. The key metric is false positives on `important` (target under 1%).
- **Privacy check:** a test that fails if any code path makes an outbound request to a host other than the mail provider or localhost.

Before saying a task is done: run `pnpm lint && pnpm typecheck && pnpm test`. If prompts, rules or policy changed, also run `pnpm eval:smoke`.

## Working style for Claude

- Read this file and the relevant package before changing code.
- Prefer small, reviewable changes that match the current roadmap phase.
- Do not add dependencies without saying why. Prefer well-maintained, small packages. Reject any dependency that phones home.
- When a change touches accuracy or safety (actions, policy, trash rule, scopes, prompts), call it out explicitly in the summary.
- Keep README, docs and this file in sync with behavior changes.
- If a request conflicts with the three promises or the security rules, stop and ask.

## Roadmap

### v0.1 (about 8 weeks)

1. **Foundations (week 1):** monorepo, CI, Gmail OAuth, fetch last 7 days into SQLite. Gate: reads the inbox reliably.
2. **Classify (weeks 2-3):** rules layer, Ollama classifier, dry-run report in CLI, eval set v1 (300 emails). Gate: a dry-run report worth trusting.
3. **Act safely (weeks 4-5):** policy engine, audit log, undo, React dashboard with first-run preview, background service, trash rule settings. Gate: two weeks on a real inbox, nothing important lost.
4. **Learn and measure (week 6):** corrections as few-shot examples via local embeddings, injection tests, model benchmark. Gate: under 1% false positives on `important`.
5. **Launch (weeks 7-8):** `init` wizard, IMAP fallback, MCP server, docs site, demo GIF, npm + Docker release. Gate: a stranger installs it in 5 minutes.

### v0.2

- Desktop app (Tauri or Electron) wrapping the same server and dashboard: double-click installer, tray icon, runs on startup, native notifications ("3 emails need you, 41 cleaned").
- Ollama setup guided from inside the app, so non-technical users never open a terminal.

Current phase: **v0.1, 3. Act safely** - specs 001 to 011 are done. The Foundations gate also wants
one run against a real mailbox, which needs a Google OAuth client.

The policy engine lives in `packages/core/src/policy`. It is the only place that decides what
happens to an email, it is pure, and it plans actions without applying any of them. Two properties
it holds and tests assert: it can never produce a `trash` action, and its safety overrides can only
remove actions, never add one. The confidence threshold is one of its settings, so whatever runs the
pipeline passes `settings.confidenceThreshold` rather than a number of its own. The under-1% target
is read strictly: a run at exactly 1% fails `pnpm eval --gate` and does not report as within the
target.

`pnpm eval` measures the pipeline against 300 synthetic emails. Two things it has already shown,
worth knowing before touching the prompt or the model:

- A model with a thinking mode cannot be used. It spends the whole reply budget on reasoning and
  returns nothing, so every email fails validation and lands in review. Measured on `qwen3-vl:8b`.
- The first baseline over-used `fyi` heavily (127 predictions against a support of 40), which pulls
  notifications and newsletters out of the cleanable categories and leaves cleamail cleaning almost
  nothing. Measured on `qwen3-vl:8b-instruct`, not the documented default, so confirm on
  `qwen2.5:7b` before changing the prompt for it.
