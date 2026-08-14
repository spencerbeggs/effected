# CLAUDE.md — the scratchpad probe workspace

This is the repo's **probe venue**: a private workspace whose only job is
letting agents settle rung-3 questions ("only a probe settles semantics")
with **typed** code. Every `@effected/*` package is a `workspace:*` dependency
and `effect` is pinned by `catalog:effect`, so a probe here type-checks against
the exact beta the kit builds with — the silent Result-accessor misread class
of probe bug dies at compile time.

## Where to write, how to run

Two working areas, both **gitignored and disposable**:

- `probes/*.ts` — free-form probes. Run: `pnpm scratchpad:probe probes/<name>.ts`
  (from the repo root; tsx handles workspace TS resolution — bare `node` cannot).
- `__test__/*.test.ts` — test-shaped probes with `@effect/vitest`. Run:
  `pnpm exec vitest run --project scratchpad --coverage.enabled=false`, or the
  vitest-agent `run_tests` tool. Results persist to the vitest-agent database
  like any package's. Without the flag, the repo's global coverage thresholds
  fail any project-scoped run — and through the MCP `run_tests` tool (which
  has the same behavior) read the Tests line, not the exit code. The
  vitest-agent reporter owns CLI output (summary line only; `--reporter=*`
  flags are overridden) — per-test names and console capture come from the
  MCP `run_tests`/`test` tools.

`pnpm scratchpad:reset` (repo root) deletes both working areas and reseeds
them from `lib/templates/`. It never runs git. Anything you leave in the
working areas is fair game for deletion by the next reset.

- `pnpm scratchpad:check` (repo root) type-checks `probes/`, `__test__/` and
  `lib/scripts/` without running anything — this is the compile-time kill for
  the Result-accessor bug class. Neither tsx nor vitest type-checks; a probe
  that must not compile is only proven by `scratchpad:check`.

All three `scratchpad:*` aliases exist only at the **repo root**. If your cwd
is `scratchpad/` itself, use the local scripts instead: `pnpm probe <file>`,
`pnpm check`, `pnpm reset`.

## Two venues — pick deliberately

- **Workspace mode** (default): a bare `@effected/<pkg>` import resolves to that
  package's `dist/dev` build (pnpm links workspace deps via `publishConfig`),
  kept fresh by install prepare hooks and the vitest pre-build. After editing a
  package's `src/`, rebuild before trusting a tsx probe:
  `pnpm build --filter @effected/<pkg>` (test-shaped probes run through vitest
  pre-build automatically via the root globalSetup).
- **Artifact mode**: deep-import `../../packages/<pkg>/dist/prod/npm/pkg/index.js`
  (see `probes/artifact-probe.ts`) to interrogate the **built artifact**.
  Build the target first: `pnpm build --filter @effected/<pkg>`.

## Probe discipline (inherited, non-negotiable)

- Print the resolved `effect` version inside every probe; a probe that
  measured the wrong version settles nothing.
- Run a control first — a line you know must fail (or must be observable).
- A probe of a multi-value API must exercise a NON-first member.
- Tests assert with `assert.*` from `@effect/vitest` — never `expect`.
- Unwrap `Result` through `__test__/utils/assert-result.js` in test-shaped
  probes, never by raw property access on an unnarrowed value. Free-form
  probes have no assert harness — there, run the effect through
  `Effect.result(...)` and branch on the returned `Result`'s `_tag` before
  touching `.success` or `.failure`.

## The committed shell is not yours to probe in

`package.json`, `tsconfig.json`, `lib/`, `__test__/utils/` and this file are
committed. Do not write probe content into them. Additions to
`__test__/utils/` are real contributions: reviewed, committed, and held to
repo quality standards. `lib/templates/` changes alter what reset seeds —
same bar. A `.test.ts` file inside `__test__/utils/` is wrong by convention
and draws a vitest-agent warning.

## Dogfood harnesses

Harnesses handed over from dogfood loops (sweeps, corpus runners) land in
`probes/` — disposable by default. If part of one proves durable, promote
that part into `__test__/utils/` as a reviewed commit.

## What this workspace is NOT

- Not a place for keepable code — durable findings go to tickets, design
  docs, or package tests; durable helpers go to `__test__/utils/`.
- Not a test suite — nothing here gates CI, coverage, or releases, and CI
  never sees the project.
- Not importable — nothing in `probes/` may be imported by any package.
