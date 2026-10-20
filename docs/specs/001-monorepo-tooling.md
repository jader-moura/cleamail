# SPEC-001: Monorepo and tooling baseline

- Phase: v0.1 - 1. Foundations
- Status: done

## Goal

A pnpm + Turborepo monorepo where every package shares one strict TypeScript, ESLint, Prettier and
Vitest setup, and CI runs lint, typecheck and test on every push.

## Scope

- pnpm workspaces (`apps/*`, `packages/*`) and the Turborepo task graph.
- `packages/config`: shared `tsconfig` bases (node, react), flat ESLint config, Prettier config,
  shared Vitest config factory.
- Root scripts exactly as documented in CLAUDE.md: `dev`, `build`, `test`, `lint`, `typecheck`.
- GitHub Actions workflow: Node 22, pnpm cache, `lint` + `typecheck` + `test` + `build`.
- `.gitignore`, `.npmrc`, `.nvmrc`, `.editorconfig`.

## Out of scope

- Any application code, any app package, Changesets release automation (comes with SPEC-023).

## Decisions

- ESLint 9 flat config with `typescript-eslint` in type-checked mode, and `no-explicit-any` as an
  error, so the "no `any`" convention is enforced by the linter and not by review.
- Turborepo v2 `tasks` syntax. `typecheck` and `build` depend on upstream `^build`; `test` and
  `lint` do not, so they stay fast.
- Prettier with only two changes from defaults (width 100, double quotes), so diffs stay boring.

## Acceptance

- `pnpm install` from a clean clone succeeds on Node 22.
- `pnpm lint && pnpm typecheck && pnpm test` passes.
- A package that uses `any` fails `pnpm lint`.
