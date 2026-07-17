# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

This is **effected**, a pnpm monorepo (npm org `@effected`) building an **Effect v4 app kit**: a coherent set of libraries designed v4-first, not a lift-and-shift of Spencer's older `*-effect` repos. Scope is closed by five consuming applications, not by how many source repos remain.

The `effect` catalog in `pnpm-workspace.yaml` pins `effect@4.0.0-beta.98`. The monorepo holds libraries only — applications stay in external repos.

**Nothing publishes to npm until the whole kit ships together at `0.1.0`.** `1.0.0` waits for Effect v4 GA. Do not release a package on its own.

## Design Documentation

Eight foundational design docs live in `.claude/design/effected/` (config: `.claude/design/design.config.json`). Load them on demand:

- Architecture → `@./.claude/design/effected/architecture.md` — Load when: changing repo structure, build pipeline, tooling, or workspace/catalog setup.
- Effect standards → `@./.claude/design/effected/effect-standards.md` — Load when: designing or porting a library API, or making dependency/peer-closure decisions.
- Package inventory → `@./.claude/design/effected/package-inventory.md` — Load when: picking the next migration target or updating a package's migration status.
- Releases → `@./.claude/design/effected/releases.md` — Load when: deciding whether work is on the release gate, scoping a package against its consumers, or reasoning about versioning.
- Roadmap → `@./.claude/design/effected/roadmap.md` — Load when: planning post-migration work, sequencing the `0.1.0` gate, or picking the next workstream.
- Migration playbook → `@./.claude/design/effected/migration-playbook.md` — Load when: starting or continuing a package migration.
- Package setup → `@./.claude/design/effected/package-setup.md` — Load when: scaffolding or adding a new workspace package.
- Plugin → `@./.claude/design/effected/plugin.md` — Load when: working in `plugin/` on the "effective" Claude Code plugin.

### Migration Status

**The migration program is complete (2026-07-12).** All seventeen library packages were merged, ending with `@effected/app` (PR #73). Two have since been extracted back to their own external repos and dropped from the kit: `runtime-resolver-cli` (now the `runtime-resolver` repo) and `ts-vfs` (now the `type-registry-effect` repo). With the new `@effected/tsconfig-json`, the kit is **18 publishable packages**; the full set is listed below and in `package-inventory.md`. `@effected/runtime-resolver` was renamed `@effected/runtimes` (b3490cf7). `@effected/json-schema` is off the roadmap entirely. New packages follow the migration playbook: design doc first, then port.

**The config-file consolidation is done.** `@effected/config-file` absorbed the three codec packages; the `jsonc`, `yaml` and `toml` **format** packages stay independent. The four codecs are **free-standing named exports** — `JsonCodec`, `JsoncCodec`, `YamlCodec`, `TomlCodec`, one module each — and `ConfigCodec` is the interface only. **Never collect them into a namespace object**: referencing one reaches every codec and drags every parsing engine into a JSON-only consumer's bundle; tree-shaking dies silently. A namespace object is a barrel with different syntax; do not reintroduce one. Read `@./.claude/design/effected/packages/config-file.md` before touching it.

Remaining `0.1.0` work is sequenced in `roadmap.md`; `package-inventory.md` and `releases.md` are authoritative — read them before starting work.

## Repository Layout

- `packages/` — the workspace packages (see below).
- `plugin/` — "effective", a Claude Code plugin (11 skills, 3 agents) dogfooded during migrations; in development.
- `website/` — RSPress docs site; per-package api-extractor models live in `website/lib/models/`.
- `.repos/effect-smol` — read-only vendored Effect v4 source (see below).
- `.claude/skills/improve` — project-level skill that maintains `plugin/skills/`.

### Package context files

Each package has its own `CLAUDE.md` and documents itself. Read it before working there; do not duplicate its content here. Parenthetical tags mark each **library's** tier (pure / boundary / integrated) per `effect-standards.md`; the lone companion package has none.

- `semver` — strict SemVer 2.0.0 schemas; the repo's DX north star (pure).
- `jsonc` — zero-dependency JSONC parse/edit/format schemas (pure).
- `yaml` — zero-dependency YAML 1.2 parse/edit/format schemas; largest package in the repo (pure).
- `package-json` — package.json schemas, validation and file IO (integrated).
- `tsconfig-json` — tsconfig.json schemas, `extends`-chain resolution and config discovery; the one new (non-migration) `0.1.0` gate package (boundary).
- `npm` — dependency-resolution contracts for `catalog:` / `workspace:` specifiers (pure).
- `config-file` — composable config file loading: codec × resolver × strategy, with the four codecs (`JsonCodec`, `JsoncCodec`, `YamlCodec`, `TomlCodec`) as free-standing named exports (boundary). Zero *external* runtime dependencies; it peers on the `jsonc`, `yaml` and `toml` format packages.
- `walker` — upward path traversal; the one absorbing loop (boundary).
- `glob` — the full minimatch dialect as pure string→predicate schemas; vendored, hardened engine (pure).
- `toml` — TOML 1.0.0 parse/edit/format schemas on a from-scratch engine; first format package with no vendored code (pure).
- `lockfiles` — bun/npm/pnpm/yarn lockfile parsers normalized into one `Lockfile` model, plus pure integrity checking (pure).
- `store` — durable local state: a migrated, schema-versioned SQLite `Store` and a TTL `Cache` with tag invalidation and eviction (integrated).
- `xdg` — XDG Base Directory resolution: `AppDirs`, `NativeDirs`, `XdgPaths` and the config-file resolvers, over `@effected/walker` (boundary).
- `workspaces` — monorepo tooling: discovery, the dependency graph, package-manager detection, pnpm catalogs, lockfile IO and git change detection; implements `@effected/npm`'s resolver contracts (integrated).
- `runtimes` — resolve semver-compatible Node, Bun and Deno versions from live feeds with an offline snapshot; its `runtime-resolver` binary ships from a separate external repo so consumers never install `@effect/platform-node` (boundary).
- `app` — the application control plane: one layer wiring XDG-namespaced directories, a migrated SQLite `Store`, a TTL `Cache` and a config file to the same place; a thin composition over `xdg` + `store` + `config-file` with no domain logic of its own (integrated, by R2 over store alone). Nothing may depend on it.
- `pnpm-plugin-effect` — pnpm catalog/config plugin. The kit's one **companion**: published and installable but not a library, so it has **no tier** (a category, not a fourth tier — see `effect-standards.md`). It **publishes with the kit at `0.1.0`** — on the release gate, not an exception. **Never infer from `"private": true` that a package will not publish** — every source manifest here is private.
- `git` — typed git introspection (a read tier of show/ls-tree/ref probes/merge-base/diffs/status) plus a marked mutating tier (checkout, fetch, submodules, sparse checkout, config, add), over core's ChildProcessSpawner required in R (boundary).

### .repos/effect-smol

A git submodule of Effect-TS/effect-smol, pinned to the tag matching the `effect` catalog (`effect@4.0.0-beta.98`) and managed by silk's repos tooling. Declared in `.gitmodules`; described by the manifest `.repos/config.json` (url / ref / purpose / sparse / orientation / notes). Vendored as **read-only Effect v4 source for agents** — the authority on what v4 actually exports.

Sparse checkout: only `packages/effect`, `packages/vitest`, `migration`, `ai-docs`, `LLMS.md` and `MIGRATION.md` are materialized.

**Never write to `.repos/effect-smol` by any means, with any tool** — the silk plugin's PreToolUse guards deny writes under `.repos/**`. Only the manifest `.repos/config.json` is legitimately editable (notes / orientation / sparse).

Re-pin when the catalog bumps, **in the same commit**: `savvy repos pin effect-smol --ref effect@<new-tag>` (or the `repos_manage` MCP tool, action `pin`). It stages the gitlink and manifest and returns a ready-made commit message; review any `staleNoteIds` it flags. Full recipe: [architecture.md](.claude/design/effected/architecture.md)'s re-pin section.

Fresh clones, CI runners and new worktrees start with an **empty** `.repos/` checkout — run `savvy repos sync` (or `repos_manage` action `sync`) once before relying on vendored content.

Exclusions: the silk Biome preset excludes `**/.repos` centrally; markdownlint ignores it via `lib/configs/.markdownlint-cli2.jsonc`; dependabot excludes `.repos/**`; it was never a pnpm workspace, turbo or vitest target and still is not.

## Build Pipeline

[Turbo](https://turbo.build/) orchestrates builds across workspace packages: `pnpm build` runs `turbo run build:dev build:prod`. Each package builds with `node savvy.build.ts` using [@savvy-web/bundler](https://github.com/savvy-web/bundler), producing `dist/dev/` and `dist/prod/` outputs. Task graph: `build:prod` depends on `types:check` and `build:dev`; both depend on upstream `^build:dev`.

**Never run `node savvy.build.ts --target prod` directly.** It skips `build:dev`, emits no `.d.ts`, and leaves a truncated `issues.json` shaped exactly like a clean gate. Build through `pnpm build --filter <pkg>`.

`@savvy-web/bundler` is a **`devDependency` of every package that builds** — it is what `savvy.build.ts` imports. **Never put it in `dependencies`**, or the publishable manifest ships a build tool at runtime. The workspace sets `autoInstallPeers: true`, so root `devDependencies` are just `@savvy-web/silk` and `@vitest-agent/plugin`, with the rest auto-installed as peers.

**Every package typechecks with `tsc --noEmit`** (the `types:check` script), with `typescript` (`catalog:silk`) as the devDependency behind it. `@effect/tsgo` was removed from all packages (d0599438) and survives only as a catalog entry with no consumer — do not reintroduce it as a package's typechecker.

Source `package.json` files are `"private": true` — this is intentional. The bundler's `publishConfig`-driven transform produces the publishable manifest at build time; never set `"private": false` in source.

## Commands

### User-run maintenance commands

`pnpm pnpm:up`, `pnpm pnpm:preview` and `pnpm pnpm:export` advance and export the Effect catalogs. They mutate the lockfile and the root `pnpm-workspace.yaml`.

**Agents must not invoke them.** Surface the right command to the user and let them run it. Advancing the beta is `pnpm pnpm:up` then `pnpm pnpm:export`.

## Tooling

The `@savvy-web/*` packages are in active development — if behavior seems unexpected, read the installed source in `node_modules/@savvy-web/`.

- **@savvy-web/bundler** — build pipeline, dual outputs, package.json transform (see Build Pipeline).
- **@savvy-web/silk** — meta-package providing Biome config, commitlint/lint-staged presets, markdownlint custom rules, and tsconfig bases. Root `tsconfig.json` extends `@savvy-web/silk/tsconfig/node/root.json`.

### Code Quality and Hooks

- **Biome**: `biome.jsonc` extends `@savvy-web/silk/biome`.
- **Commitlint**: `lib/configs/commitlint.config.ts` uses `CommitlintConfig.silk()`.
- **Lint-staged**: `lib/configs/lint-staged.config.ts` uses `Preset.silk()`.
- **Markdownlint**: config at `lib/configs/.markdownlint-cli2.jsonc`. Check with `pnpm lint:md`, fix with `pnpm lint:md:fix`.
- **Husky hooks**: `pre-commit` runs lint-staged; `commit-msg` runs commitlint; `post-checkout` / `post-commit` / `post-merge` maintain file modes and script exec bits.

**Never invoke `markdownlint-cli2` directly — run `pnpm lint:md` or `pnpm lint:md:fix`.** The tool *merges* explicit path arguments with the config's repo-wide `globs` rather than narrowing to them, so "lint just my file" lints every markdown file in the repo. The config deliberately omits `fix` (present, it overrides the `--fix` flag in both directions) so the flag decides.

**Never run `git checkout` / `git restore` / `git stash` to undo unexpected working-tree changes.** Other agents and earlier steps hold uncommitted work there. Inspect the diff and repair what is actually wrong.

## Conventions

### Dependencies

Shared dependency versions come from pnpm catalogs in `pnpm-workspace.yaml` (`catalog:effect`, `catalog:effectPeers`, `catalog:silk`, plus the `effect3` / `effect3Peers` v3 interop catalogs), managed via `packages/pnpm-plugin-effect`.

**`catalog:effect` uses the `lock` strategy: exact beta pins (`4.0.0-beta.98`), never a caret.** A caret on a prerelease floats across the beta line and silently desynchronizes the installed `effect` from the `.repos/effect-smol` submodule, the authority on what v4 exports. Under `lock` every consumer resolves that one pinned version, so `catalog:effectPeers` holds the same exact beta, not a caret floor. The `effect3` / `effect3Peers` interop catalogs track the latest Effect **v3** (caret-ranged, not synced to the vendored tree) for dual-version testing, and drop at the plugin's `1.0.0`.

**`pnpm peers check` reports exactly one known issue**: `rolldown-pnpm-config`'s Effect **v3** satellites report unmet `effect` peers inside `packages/pnpm-plugin-effect` — they want v3 in a context that installs the v4 beta, a consequence of the bundler 2.0 upgrade, recorded as the open defect in `effect-standards.md`; the candidate fix is upstream in the external rolldown-pnpm-config repo. Do not silence it or tolerate a second: **any other warning is a genuine closure defect to fix upstream.**

**Always check the lockfile diff after an install** — a plain `pnpm install` once stripped turbo / biome / tsgo platform binaries from it.

Why these hold (the `autoInstallPeers` mechanics, the `lock` vs `interop` catalog strategies) → `@./.claude/design/effected/architecture.md`. Load when: editing catalogs, catalog strategies, or peer declarations.

### Commits

All commits require conventional commit format (`feat`, `fix`, `chore`, ...) and a DCO signoff (`Signed-off-by: Name <email>`).

Commit bodies are **plain prose** — no backticks, bullets, or code spans (`silk/body-no-markdown`). `design:` is not a valid commit type.

## Testing

- **Framework**: [Vitest](https://vitest.dev/) with the `@vitest-agent/plugin` `AgentPlugin` (project discovery, agent-friendly output, v8 coverage with `basic` thresholds); pool is `forks`.
- **Effect code**: test with `@effect/vitest` (`catalog:effect`), and assert with `assert.*` — **never `expect`**.
- **Location**: tests live in each package's `__test__/` directory, never co-located in `src/` (unit: `*.test.ts`; e2e: `e2e/*.e2e.test.ts`; integration: `integration/*.int.test.ts`).
- **CI**: `pnpm ci:test` sets `CI=true`.
