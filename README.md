# cleamail

A local-first email agent. It reads your Gmail or IMAP inbox, classifies every message with a local
LLM, clears out what you do not need, and surfaces what deserves your attention.

Three promises:

- **Accurate.** Dry-run first, a reason on every decision, undo on every action. The metric that
  matters is false positives on `important`, targeted under 1%.
- **Private.** Everything runs on your machine. Email content never leaves it. The only network
  calls are to your mail provider and to Ollama on localhost. No telemetry, ever.
- **Free.** Open source, no API keys, no subscriptions. Your machine does the work.

## Status

Early development: **v0.1, phase 1 (Foundations) is code complete**. It can connect a Gmail account
and read mail into a local database. It does not classify or change anything yet. Progress is
tracked as small specs in [docs/specs](docs/specs/README.md).

| Spec | What                          | Status |
| ---- | ----------------------------- | ------ |
| 001  | Monorepo and tooling baseline | done   |
| 002  | Core domain model and ports   | done   |
| 003  | SQLite store                  | done   |
| 004  | Gmail provider and OAuth      | done   |
| 005  | CLI: init, run, status        | done   |
| 006  | Privacy guard                 | done   |
| 007  | Rules layer                   | done   |
| 008  | Ollama classifier             | done   |
| 009  | Dry-run report in the CLI     | done   |
| 010  | Evals and eval set v1         | next   |

## What a dry run looks like

`cleamail run --dry-run --since 7d` fetches recent mail, classifies it locally and prints what it
thinks. Nothing in the mailbox is changed.

```
needs attention (2)
  important    Your payment of 1,240.00 was received
               Bank <receipts@your-bank.example>
               This is a mortgage payment confirmation with real financial consequen…
  needs_reply  Can you review the draft by Friday?
               Sam <sam@client.example>
               The sender is asking you to review a draft and respond by Friday, whi…

needs review (1)
  looks like a forgery  Urgent: verify your account
                        PayPal Security <security@paypa1-verify… (looked like suspicious)

would be cleaned (3)
  newsletter   1
  promotion    1
  notification 1

summary
  classified    6
  by rules      2 (no model call)
  by model      4 (qwen2.5:7b)

Nothing in your mailbox was changed.
```

Every email is accounted for, every decision carries its reason, and the summary shows how much of
the result came from deterministic rules rather than the model.

## How the privacy promise is enforced

Not by a statement in this README. `packages/privacy` installs a guard over `fetch`, the `http` and
`https` request functions and DNS, runs the real Gmail client and the real OAuth flow through it,
and fails if anything reaches a host other than your mail provider or your own machine. A second
check scans every source, HTML and CSS file in the repository for a host that is neither contacted
nor documented, so a CDN script or a Google Font cannot appear unnoticed. A third asserts that a
whole fetch-and-store run makes no outbound call at all.

## Connecting a mailbox

Gmail needs your own Google OAuth client, which takes about three minutes to create and keeps every
request between your browser and Google. See [docs/gmail-setup.md](docs/gmail-setup.md).

## Requirements

- Node 22 or newer, and pnpm
- [Ollama](https://ollama.com) on `http://localhost:11434` with `qwen2.5:7b` and `nomic-embed-text`
  pulled (a smaller model is recommended on CPU-only machines)

## Development

```bash
pnpm install
pnpm dev          # server + web dashboard in watch mode (from phase 3)
pnpm test         # vitest, all packages
pnpm lint
pnpm typecheck
pnpm build
```

Before anything is called done: `pnpm lint && pnpm typecheck && pnpm test`.

The CLI, while it is being built:

```bash
pnpm --filter @cleamail/cli dev -- init
pnpm --filter @cleamail/cli dev -- run --dry-run --since 7d
pnpm --filter @cleamail/cli dev -- status
```

`CLEAMAIL_DB` points the database somewhere other than the per-user data directory, which is handy
while developing.

## Layout

```
apps/
  cli/        # the `cleamail` command
  server/     # Fastify on 127.0.0.1: local API, scheduler, serves the dashboard
  web/        # React dashboard
  mcp/        # MCP server: read-only queries and safe actions
packages/
  core/       # domain model and ports. No I/O.
  providers/  # Gmail and IMAP adapters
  llm/        # Ollama adapter, versioned prompts
  store/      # SQLite + Drizzle
  evals/      # dataset, metrics, benchmark runner
  privacy/    # the outbound-host guard, used by the other packages' tests
  config/     # shared tsconfig, ESLint, Prettier, Vitest
```

The LLM never gets tools and never chooses what happens to a message. It returns a JSON
classification, Zod validates it, and a deterministic policy engine decides the action. Invalid
output is routed to `cleamail/Review`, never to an action.

## License

MIT
