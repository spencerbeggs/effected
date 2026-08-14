---
status: current
module: effected
category: architecture
created: 2026-08-14
updated: 2026-08-14
last-synced: 2026-08-14
completeness: 95
related:
  - architecture.md
  - plugin.md
  - benchmarking.md
---

# The `scratchpad/` agent-probe workspace

## Overview

The `scratchpad/` workspace lets agents write **typed** probes fast — the evidence ladder's rung 3 ("only a probe settles semantics") tooled instead of hand-rolled. It was designed from [issue #346](https://github.com/spencerbeggs/effected/issues/346) (all three open questions are settled below) and is fully implemented; `scratchpad/` and the root wiring are the authority on mechanics, and `scratchpad/CLAUDE.md` is the in-directory contract agents actually read.

The motivation is the yaml #338 branch, where every hard question was settled by untyped `node -e` probes against dist paths — one of which silently misread the v4 `Result` accessor. Typed probes kill that bug class at compile time. The downstream dogfood partner independently built the same thing ad hoc (`sweep.mjs`), confirming the need is real, not local.

## Architecture: the ghost workspace

`scratchpad/` is a real pnpm workspace member — listed in `pnpm-workspace.yaml` — so `workspace:*` dependencies resolve and the tooling ecosystem (turbo, vitest-agent, pnpm) treats it normally. But it is a **fixture, not a package**:

- `"name": "scratchpad"`, `"private": true`, `"type": "module"`, **no** `publishConfig`. No `savvy.build.ts`, no build scripts — its only scripts are the three runners (`probe`, `check`, `reset`).
- Dependencies: `effect: catalog:effect` and **all 28** `@effected/*` packages at `workspace:*`. DevDeps: `@effect/vitest` (`catalog:effect`), `tsx`, `typescript` and `@types/node` (`catalog:build`). **No `vitest` devDep** — the project runs through the root vitest install; adding one locally would only invite version skew.
- Exclusions make it a "ghost": `"scratchpad"` in the `ignore` array of `.changeset/config.json` (alongside `"docs"`); skipped by the vitest discover strategy when `CI` is set; `scratchpad/**` in the root coverage `exclude`.

The manifest **is committed**. A fully gitignored workspace member would cause lockfile importer churn on fresh clones — only the probe working areas are ignored.

## Layout

```text
scratchpad/
  package.json                 # committed — ghost-workspace manifest
  tsconfig.json                # committed — extends root; includes probes/, lib/scripts/, __test__/
  CLAUDE.md                    # committed — the in-directory contract for agents
  lib/
    scripts/reset.ts           # committed — reset script (lib/ is linted+typechecked by the repo toolchain)
    templates/                 # committed — pristine seeds: probe.ts, artifact-probe.ts, probe.test.ts
  __test__/
    utils/                     # committed — reviewed reusable helpers (assert-result.ts, oracle.ts)
    probe.test.ts              # GITIGNORED — seeded demo suite; agent test-probes live here
  probes/                      # GITIGNORED — free-form tsx probes (seeded: probe.ts, artifact-probe.ts)
```

`.gitignore` has `scratchpad/probes/` and `scratchpad/__test__/*.test.ts`; `__test__/utils/` stays tracked. `utils/` follows the house convention as the helpers-only folder — the vitest-agent plugin warns if a `.test.ts` lands there.

## Two probe venues

Settles issue #346 open question 1. The original design assumed workspace imports resolve to `./src/index.ts` ("source mode, zero staleness"); implementation disproved that, so **there is no zero-staleness venue** — both venues read built output and differ in which build they read.

- **Workspace mode** (the default for API-semantics probes): a bare `@effected/<pkg>` import resolves through pnpm's workspace linking — which honors each package's `publishConfig.linkDirectory`/`directory` — to that package's **`dist/dev/pkg` build** (verified: `scratchpad/node_modules/@effected/app -> ../../../packages/app/dist/dev/pkg`). Probes type against the dev build's declarations, kept fresh by install prepare hooks plus the vitest globalSetup turbo pre-build. After editing a package's `src/`, run `pnpm build --filter @effected/<pkg>` before trusting a tsx probe; test-shaped probes get the pre-build automatically.
- **Artifact mode**: deep-import `packages/<pkg>/dist/prod/npm/pkg/...` to interrogate the **built prod artifact**, typed via `as unknown as typeof import("@effected/<pkg>")` — the double cast is required because dev and prod declarations of private-field classes are nominally distinct. `lib/templates/artifact-probe.ts` demonstrates it. Build the target first.

## Three runners

- **Free-form probes**: `pnpm scratchpad:probe probes/<name>.ts` from the repo root (`pnpm --filter scratchpad probe` under the hood, backed by tsx — bare Node cannot resolve the workspace TS setup).
- **Test-shaped probes**: `__test__/*.test.ts` with `@effect/vitest` (`assert.*`, never `expect`). The standard `__test__/` shape means the **stock** `AgentPlugin.discover` picks it up as an ordinary project, so probes run through the root vitest CLI **and** the vitest-agent MCP `run_tests`, with persisted results and history. The documented invocation is `pnpm exec vitest run --project scratchpad --coverage.enabled=false` — without the flag the repo's global coverage thresholds fail any project-scoped run; the MCP `run_tests` path has the same behavior, so read the Tests line, not the exit code. The seeded `probe.test.ts` demonstrates both shapes: `it.effect` for Effect-typed probes and plain `it` for sync ones — a yield-less `Effect.gen` would trip Biome's error-level `useYield` rule.
- **Type-check probes**: `pnpm scratchpad:check` (`"check": "tsc --noEmit"` in the scratchpad manifest). Neither tsx nor vitest type-checks — both strip types without checking — so this is the only compile-time proof, and the compile-time kill for the Result-accessor bug class. The script is deliberately **not** named `types:check`: that name would put it in turbo's repo-wide `types:check` task graph, and the scratchpad must stay out of it.

Root convenience aliases: `scratchpad:probe`, `scratchpad:check`, `scratchpad:reset`.

## Freshness: turbo pre-build in the root globalSetup

The root `vitest.setup.ts` (wired as `globalSetup` in the root `vitest.config.ts`) runs `turbo run build:dev` through `AgentPlugin.runScript` before every vitest run, CLI or MCP, any project — a turbo-cache no-op when nothing changed. Since workspace mode reads `dist/dev`, this matters for both venues, not just artifact probes.

## Vitest and coverage integration

The root `vitest.config.ts` extends `DefaultDiscoverStrategy`: `buildProject` returns null for scratchpad when the `CI` env is set, so `ci:test` never sees it; locally it builds as a normal project. `scratchpad/**` is in the coverage `exclude` — probes are instruments, not covered code.

## Reset

`scratchpad/lib/scripts/reset.ts`, run via `pnpm scratchpad:reset` (tsx). It deletes the contents of the two ignored zones only (`probes/`, `__test__/*.test.ts`), reseeds the three files from `lib/templates/` — `probes/probe.ts`, `probes/artifact-probe.ts` and `__test__/probe.test.ts` — and prints what it deleted. **No git commands ever** (house rule: never `checkout`/`restore` to undo working-tree state); committed files are outside its blast radius by construction.

## The in-directory contract (scratchpad CLAUDE.md)

The committed `scratchpad/CLAUDE.md` states: the purpose (rung-3 probes); the two venues and when each applies; the three runners with exact commands; that `probes/` and `__test__/*.test.ts` are gitignored and disposable while everything else is committed and off-limits for probe content; that `__test__/utils/` additions are real reviewed contributions; reset semantics; and the inherited hard rules (print the resolved `effect` version, run a control first, exercise a non-first member, `assert.*` never `expect`). It also states what the workspace is **not**: not a place for keepable code, not a test suite, and nothing in `probes/` may be imported by any package.

## Plugin guidance

Settles issue #346 open question 2. Two surgical amendments to existing plugin skills, no new skill: `effect-v4-source-lookup` names the scratchpad as the sanctioned rung-3 venue (replacing hand-rolled `node -e` guidance and lifting its placement/deletion preconditions inside the scratchpad), and `effect-v4-planning`'s probe step points the same way. The wording degrades gracefully since the plugin ships to other repos: "if the repo has a `scratchpad/` workspace, use it; otherwise inline probe."

## Dogfood harness landing path

Settles issue #346 open question 3. Handed-over harnesses (e.g. the systems `sweep.mjs`) land in `probes/` — disposable by default. Durable parts get promoted into `__test__/utils/` as a reviewed commit. One paragraph in the scratchpad CLAUDE.md covers this.

## Deliberately excluded (YAGNI)

- No probe archival or numbering — ignored means disposable; durable findings go to tickets or design docs.
- No turbo tasks for scratchpad itself — even the type-check ships as a root alias (`scratchpad:check`) precisely to stay out of the graph.
