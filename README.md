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

Early development: **v0.1, phase 1 (Foundations)**. Not usable yet. Progress is tracked as small
specs in [docs/specs](docs/specs/README.md).

| Spec | What                          | Status |
| ---- | ----------------------------- | ------ |
| 001  | Monorepo and tooling baseline | done   |
| 002  | Core domain model and ports   | done   |
| 003  | SQLite store                  | next   |

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
  config/     # shared tsconfig, ESLint, Prettier, Vitest
```

The LLM never gets tools and never chooses what happens to a message. It returns a JSON
classification, Zod validates it, and a deterministic policy engine decides the action. Invalid
output is routed to `cleamail/Review`, never to an action.

## License

MIT
