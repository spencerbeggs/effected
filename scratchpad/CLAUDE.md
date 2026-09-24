# CLAUDE.md — the scratchpad probe workspace

**Concept:** `okf/modules/scratchpad.md` — Load when: changing this workspace's
committed shell or its ghost-workspace exclusions; it also names the sibling
`okf/glossary/ghost-workspace.md` term this workspace is an instance of. Do not
restate that material here.

This is the repo's **probe venue**: a private workspace whose only job is
letting agents settle rung-3 questions ("only a probe settles semantics")
with **typed** code. Every `@effected/*` package is a `workspace:*` dependency
and `effect` is pinned by `catalog:effect`, so a probe here type-checks against
the exact prerelease the kit builds with — the silent Result-accessor misread
class of probe bug dies at compile time.

**This is not the agent harness's own scratch directory.** Most sessions are
also handed a private scratch *directory* under `/tmp`, named in the system
prompt; it has no `node_modules`, so a probe written there dies with
`ERR_MODULE_NOT_FOUND: Cannot find package 'effect'` — reached by a route that
feels like *following* the probe-venue rule. The venue is this `scratchpad/`
directory **inside the repo**, resolved from the repo root (re-proven
2026-08-23).

## Where to write, how to run

Two working areas, both **gitignored and disposable**:

- `probes/*.ts` — free-form probes. Run: `pnpm scratchpad:probe probes/<name>.ts`
  (from the repo root; tsx handles workspace TS resolution — bare `node` cannot).
- `__test__/*.test.ts` — test-shaped probes with `@effect/vitest`. Run from
  the repo root (from `scratchpad/` vitest does not load the root config and
  `--project` finds no projects):
  `pnpm exec vitest run --project scratchpad --coverage.enabled=false`, or the
  vitest-agent `run_tests` tool. Results persist to the vitest-agent database
  like any package's. The flag keeps concurrent agents off the shared
  coverage directory; a project-scoped run with coverage on skips the global
  thresholds (`Coverage thresholds skipped: partial run`). Read both the Tests
  line and the exit code: a filter that matches nothing prints
  `Tests: 0/0 passed` and exits 1. The
  vitest-agent reporter owns the TERMINAL output (summary line only;
  `--reporter=*` flags do not change it) — per-test names and console capture
  come from the MCP `run_tests`/`test` tools. A file reporter still writes:
  `--reporter=json --outputFile=<path>` is how a property test's shrunk input
  and replay token are read, since the terminal compacts a falsification to
  `Property falsified after N run(s)`. **`console.log` inside a `__test__/`
  probe is swallowed** by the vitest-agent reporter, which owns the terminal
  output — write what you need to read back to a file (`--outputFile`) rather
  than a `console.log` you expect to see; a `probes/*.ts` `tsx` probe has no
  such reporter in front of it and prints normally.

`pnpm scratchpad:check` **can be red from another session's stale probe file**
that has nothing to do with your own work — the type-check program covers
every file under `probes/`, `__test__/` and `lib/scripts/` at once, shared
across every agent using this workspace concurrently. Judge only your own
files: filter the output to your own paths, and plant a known-bad control
file first (a line you know must fail) to prove the filter is actually live
before trusting a clean read on it — a filter that matched nothing would
look identical to a clean tag. `pnpm scratchpad:reset` is the other option
when a stale probe is in your way, but it deletes every session's probes,
not just the stale one.

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

- Not a place for keepable code — durable findings go to tickets, `okf/`
  concepts, or package tests; durable helpers go to `__test__/utils/`.
- Not a test suite — nothing here gates CI, coverage, or releases, and CI
  never sees the project.
- Not importable — nothing in `probes/` may be imported by any package.
