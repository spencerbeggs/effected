---
type: Module
title: workspace
description: The monorepo root — layout, build pipeline, dependency resolution and vendored source.
status: stable
kind: workspace
resource: ../..
tags:
  - architecture
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-24T05:36:02Z
  body_sha256: dfa491cff633d8a2e44d2d53ba32e0753107ebbdf42c4a4baccccc2894333f89
---

# workspace

## Purpose

The repository root: the `packages/*` layout, the pnpm workspace and Effect catalogs, the turbo/bundler build pipeline, Biome/commitlint/lint-staged/markdownlint presets, and the read-only vendored reference sources under `.repos/`. Every package Module sits underneath this one and inherits its build, lint and dependency-resolution rules.

## Layout

- `packages/*` — one directory per `@effected` library.
- `packages/pnpm-plugin-effect` — the kit's companion (pnpm catalog/config plugin): published with the kit and installable by consumers, but not a library, so it carries no tier.
- `plugins/` — the repo's two agent plugins, each a workspace member with its own private tracking package that versions it but never publishes to npm: `plugins/claude-code/` (the "effected" Claude Code plugin, source of truth for skill and agent content) and `plugins/copilot/` (an experimental GitHub Copilot port, trailing it downstream). See [claude-code-plugin](claude-code-plugin.md) and [copilot-plugin](copilot-plugin.md).
- `.claude/skills/improve` — the project-level self-improvement skill that maintains `plugins/claude-code/skills/`.
- `.repos/` — read-only vendored sources as sparse git submodules; see [Vendored source](#vendored-source).
- `website/` — the RSPress docs site, with per-package api-extractor models under `website/lib/models/`; see [website](website.md).
- `scratchpad/` — a private agent-probe workspace member, never published and invisible to CI; see [scratchpad](scratchpad.md).

Build tooling comes from two `@savvy-web` packages: `bundler` (each package's `savvy.build.ts`, the dual dev/prod outputs, and the `publishConfig` manifest transform that produces the publishable manifest at build time from a `"private": true` source manifest) and `silk` (the Biome, commitlint, lint-staged and markdownlint presets, plus the tsconfig bases), orchestrated by [Turbo](https://turbo.build/).

## Build pipeline

`pnpm build` runs `turbo run build:dev build:prod`. Each package builds through `node savvy.build.ts` via `@savvy-web/bundler`, producing `dist/dev/` and `dist/prod/` outputs; `build:prod` depends on `types:check` and `build:dev`, and both depend on upstream `^build:dev`. `@savvy-web/bundler` is a `devDependency` of every building package, never a `dependency` — a published manifest that carried it would ship a build tool at runtime. Never run `node savvy.build.ts --target prod` directly: it skips `build:dev`, emits no `.d.ts`, and leaves a truncated `issues.json` shaped exactly like a clean gate; build through `pnpm build --filter <pkg>` instead.

A turbo cache hit replays the previous run's output **verbatim** — the same `FULL TURBO` line, the same emitted-file count, the same `suppressed` figure a clean gate prints — so a clean log does not prove a build ran. The tell is `dist/<target>/issues.json`'s `generatedAt`, which must postdate the last source edit; a replay against unchanged inputs is legitimate, one predating the edit means the reader is looking at someone else's gate.

Every package typechecks with `tsc --noEmit` (`types:check`) against `typescript` from `catalog:build`. `catalog:build` is deliberately absent from `pnpm-workspace.yaml` — it is injected by the `@savvy-web/pnpm-plugin-silk` config dependency, so its absence there is expected and must never be "repaired" by adding it. `@effect/tsgo` was removed from every package and survives only as an unused catalog entry; do not reintroduce it as a package's typechecker (see [tsc, not tsgo](../decisions/tsc-not-tsgo.md)).

The root `tsconfig.json` sets `skipLibCheck: true` as a deliberate override of the silk preset's default (`false`), because `vitest@5.0.0` ships a broken `.d.ts` (`dist/chunks/plugin.d.ts` imports `MarkOptions` from `vitest/browser`, which `dist/browser.d.ts` does not export) that was the only error in the whole root program and failed the pre-commit hook's `tsc --noEmit` on every commit. Drop the override once vitest ships a consistent declaration; per-package `types:check` is unaffected either way.

## Code quality and hooks

Biome, commitlint, lint-staged and markdownlint all take their presets from `@savvy-web/silk` (configs at the repo root and in `lib/configs/`). Never invoke `markdownlint-cli2` directly — it *merges* explicit path arguments with the config's repo-wide `globs` rather than narrowing to them, so "lint just my file" lints the whole repository; run `pnpm lint:md` or `pnpm lint:md:fix` instead. Never run `git checkout` / `git restore` / `git stash` to undo unexpected working-tree changes — other agents and earlier steps may hold uncommitted work there.

## Vendored source

`.repos/` holds read-only vendored sources as sparse git submodules, declared in `.gitmodules` and described by the `.repos/config.json` manifest (url, ref, purpose, sparse paths, orientation notes) — see [the vendored-repos manifest interface](../interfaces/vendored-repos-manifest.md). `.repos/effect` is the load-bearing entry, pinned to the release tag matching the `effect` catalog pin in `pnpm-workspace.yaml` rather than tracking `main` — see [vendored Effect is pinned to the catalog tag](../decisions/vendored-effect-pinned-to-catalog-tag.md). The rest are port bases and oracles for the `markdown` package.

The checkout is **sparse**: for `.repos/effect`, only `packages/effect` (the v4 export authority), `packages/vitest` (the `@effect/vitest` reference implementation) and `migration`, `ai-docs`, `LLMS.md`, `MIGRATION.md` (the rename evidence for the plugin's evidence ladder) are materialized.

Submodule content is not stored in the parent tree, so fresh clones, CI runners and new git worktrees start with an **empty** `.repos/` checkout — see [vendored repos are empty on a fresh clone](../gotchas/vendored-repos-empty-on-fresh-clone.md) and [sync the vendored repos](../runbooks/sync-vendored-repos.md). Re-pinning when the `effect` catalog bumps is one operation, folded into the catalog-bump commit — see [advance the effect pin](../runbooks/advance-the-effect-pin.md).

The vendored tree is **read-only, and enforced rather than trusted**: the silk plugin's PreToolUse guards deny Write, Edit, Bash and MCP-git mutations under `.repos/**`. It also stays outside every build and lint graph — the silk Biome preset centrally excludes `**/.repos`, markdownlint's config keeps `**/.repos` in its ignores, dependabot excludes `.repos/**`, and pnpm, turbo and vitest never matched the directory by glob in the first place.

## Dependency resolution

The whole tree resolves to **one** `effect` copy — this workspace and the build toolchain (`@savvy-web/*`, rolldown-pnpm-config, vitest-agent) alike, on the prerelease the catalogs pin. See [one resolved effect copy](../conventions/one-resolved-effect-copy.md) for why that is a correctness requirement rather than hygiene, and for the toolchain bridge shapes an advance may need.

The Effect catalogs — `effect` and `effect:peers` in `pnpm-workspace.yaml` — pin **exact** prerelease versions with no caret, generated by [`pnpm-plugin-effect`](pnpm-plugin-effect.md) under a `lock` strategy; see [the effect catalog pins exact versions](../decisions/effect-catalog-exact-pins.md). No Effect v3 catalog exists: the `effect3` / `effect3:peers` pair and the camelCase `effectPeers` / `effect3Peers` aliases are retired, and a catalog spelled that way is a stale reference to repair, not a surface to restore.

The same plugin also publishes an `effected` / `effected:peers` pair carrying the kit's own packages, for consumers only — not exported into `pnpm-workspace.yaml`, since internal edges stay `workspace:*` — under a `lock-minor` strategy with caret ranges, kept current by a workflow triggered on pull requests to `main` and to `changeset-release/main`.

The build-tooling versions (`typescript`, `@types/node`, the bundler's own stack) come from `catalog:build`, injected by the `@savvy-web/pnpm-plugin-silk` config dependency rather than declared in `pnpm-workspace.yaml`; check the installed plugin under `node_modules/.pnpm-config/` when a `catalog:build` version needs verifying.

`pnpm peers check` carries one expected, rotating occupant: a downstream package pinning an older `@effected/*` caret than the kit's current release, always in the *toolchain* graph rather than this workspace, always clearing when that tool republishes against the current prerelease. Any other warning is a genuine closure defect to fix upstream, not a second expected residual. Always check the lockfile diff after an install — a plain `pnpm install` has once stripped the turbo, biome and tsgo platform binaries from it.

**User-run only:** `pnpm pnpm:up`, `pnpm pnpm:preview` and `pnpm pnpm:export` advance and export the Effect catalogs, mutating the lockfile and the root `pnpm-workspace.yaml`. Agents must not invoke them — surface the command and let the user run it. Agents may run `pnpm catalog:check` (a read-only drift gate) and `pnpm catalog:sync`, which write nothing but `packages/pnpm-plugin-effect/savvy.build.ts` and one fixed-name changeset.

## Testing

Vitest with the `@vitest-agent/plugin` `AgentPlugin`; tests live in each package's `__test__/` directory, never co-located in `src/`. Effect code is tested with `@effect/vitest`, asserting with `assert.*` rather than `expect`. A test needing `FileSystem` provides `memfs`, never a hand-rolled `FileSystem.layerNoop` double, because `layerNoop` is deny-by-default and a stub encodes only what its author remembered. Full rules and riders → [testing standards](../conventions/testing-standards.md).

The root `globalSetup` (`vitest.setup.ts`) runs `pnpm exec turbo run build:dev --output-logs=errors-only` via `AgentPlugin.runScript` before **every** vitest run — CLI and the MCP `run_tests` tool alike, whichever project — so tests always see fresh `dist/dev` artifacts; turbo's cache makes it a fast no-op when nothing changed. Run vitest from the repo root: from inside a package directory vitest does not load the root config, so `--project @effected/<pkg>` fails with `No projects matched the filter` and the repo's setup, plugins and reporter are all absent. From the root, prefer `vitest run --project @effected/<pkg>`. A bare positional filter is matched as a substring against each test file's path, not as a path selector — see [a vitest positional filter is a substring match, and a package-dir run never loads the root config](../gotchas/vitest-positional-filter-is-cwd-relative.md) for the measured comparison and the `Tests: 0/0 passed` / exit 1 shape a miss produces.

`pnpm ci:test` sets `CI=true`. The global coverage thresholds in `vitest.config.ts` are set unconditionally. They measure the whole repository, so a filtered run cannot meet them — but `@vitest-agent/plugin` (4.x) detects a partial run (positional filter, `--project`, `--tags-filter`, `--changed`, `--related`, `--shard`, `-t`) and skips them, printing `Coverage thresholds skipped: partial run`. A filtered run's exit code is therefore a real signal; do not reintroduce a CI-only gate around the thresholds.

Three of this repository's gates — the `suppressed:` count in `issues.json`, the `Tests:` line, and `packages.length`-style fixture assertions — work by asserting a number did not change unexpectedly; state which count moved and why whenever one does, per [state the reason when a gate count moves](../conventions/state-the-reason-when-a-gate-count-moves.md).
