# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

This is **effected**, a pnpm monorepo (npm org `@effected`) building an **Effect v4 app kit**: a coherent set of libraries designed v4-first, not a lift-and-shift of Spencer's older `*-effect` repos. Scope is closed by five consuming applications, not by how many source repos remain.

The `effect` catalog in `pnpm-workspace.yaml` pins `effect@4.0.0-beta.94`. The monorepo holds libraries only — applications stay in external repos.

**Nothing publishes to npm until the whole kit ships together at `0.1.0`.** `1.0.0` waits for Effect v4 GA. Do not release a package on its own.

## Design Documentation

Seven foundational design docs live in `.claude/design/effected/` (config: `.claude/design/design.config.json`). Load them on demand:

- Architecture → `@./.claude/design/effected/architecture.md` — Load when: changing repo structure, build pipeline, tooling, or workspace/catalog setup.
- Effect standards → `@./.claude/design/effected/effect-standards.md` — Load when: designing or porting a library API, or making dependency/peer-closure decisions.
- Package inventory → `@./.claude/design/effected/package-inventory.md` — Load when: picking the next migration target or updating a package's migration status.
- Releases → `@./.claude/design/effected/releases.md` — Load when: deciding whether work is on the release gate, scoping a package against its consumers, or reasoning about versioning.
- Migration playbook → `@./.claude/design/effected/migration-playbook.md` — Load when: starting or continuing a package migration.
- Package setup → `@./.claude/design/effected/package-setup.md` — Load when: scaffolding or adding a new workspace package.
- Plugin → `@./.claude/design/effected/plugin.md` — Load when: working in `plugin/` on the "effective" Claude Code plugin.

### Migration Workflow

Migrations happen one package at a time per the migration playbook: write the package's design doc first, then port.

Eight packages are merged: `semver`, `jsonc`, `yaml`, `package-json`, `npm`, `config-file`, `config-file-jsonc`, `config-file-yaml`. Ten remain, in order: **walker → toml → config-file-toml → lockfiles → store → xdg → workspaces → app-kit → type-registry → runtime-resolver**. `@effected/json-schema` is off the roadmap entirely.

The order after `walker` firms up as lessons land. `package-inventory.md` and `releases.md` are authoritative — read them before starting work.

## Repository Layout

- `packages/` — the workspace packages (see below).
- `plugin/` — "effective", a Claude Code plugin (10 skills, 3 agents: `effect-developer`, `effect-reviewer`, `effect-migrator`) dogfooded during migrations; in development.
- `website/` — RSPress docs site; per-package api-extractor models live in `website/lib/models/`.
- `repos/effect-smol` — read-only vendored Effect v4 source (see below).
- `.claude/skills/improve` — project-level skill that maintains `plugin/skills/`.

### Package context files

Each package has its own `CLAUDE.md` and documents itself. Read it before working there; do not duplicate its content here.

- `semver` — strict SemVer 2.0.0 schemas; the repo's DX north star (pure).
- `jsonc` — zero-dependency JSONC parse/edit/format schemas (pure).
- `yaml` — zero-dependency YAML 1.2 parse/edit/format schemas; largest package in the repo (pure).
- `package-json` — package.json schemas, validation and file IO (boundary).
- `npm` — dependency-resolution contracts for `catalog:` / `workspace:` specifiers (pure).
- `config-file` — composable config file loading: codec × resolver × strategy (boundary).
- `config-file-jsonc` — `ConfigCodec` adapter over `@effected/jsonc` (pure).
- `config-file-yaml` — `ConfigCodec` adapter over `@effected/yaml` (pure).
- `pnpm-plugin-effect` — pnpm catalog/config plugin; repo infrastructure, not a library migration, so the tier taxonomy does not apply. It does publish to npm, as an optional convenience letting users pin their `effect` dependencies and peer floors the way this repo does.

### repos/effect-smol

A `git subtree` of Effect-TS/effect-smol, pinned to the tag matching the `effect` catalog (`effect@4.0.0-beta.94`). It is vendored as **read-only Effect v4 source for agents** — the authority on what v4 actually exports.

It is excluded from pnpm (not a workspace package), turbo, vitest, Biome (`"includes": ["!repos"]`) and markdownlint (`"ignores": ["**/repos/**"]`).

**Never point a writing tool at it.** The markdownlint config sets `"fix": true`, so an invocation aimed explicitly at that path silently rewrites the vendored migration notes. Never write to `repos/effect-smol` by any means.

Re-pin when the catalog bumps:

```bash
git subtree pull --prefix=repos/effect-smol <url> effect@<tag> --squash
```

## Build Pipeline

[Turbo](https://turbo.build/) orchestrates builds across workspace packages: `pnpm build` runs `turbo run build:dev build:prod`. Each package builds with `node savvy.build.ts` using [@savvy-web/bundler](https://github.com/savvy-web/bundler), producing `dist/dev/` and `dist/prod/` outputs. Task graph: `build:prod` depends on `types:check` and `build:dev`; both depend on upstream `^build:dev`.

**Never run `node savvy.build.ts --target prod` directly.** It skips `build:dev`, emits no `.d.ts`, and leaves a truncated `issues.json` shaped exactly like a clean gate. Build through `pnpm build --filter <pkg>`.

`@savvy-web/bundler` lives in the **root** `devDependencies` deliberately — package `savvy.build.ts` scripts resolve it via Node's upward `node_modules` walk; do not move it into package `devDependencies`. The workspace sets `autoInstallPeers: true`, so root `devDependencies` collapse to `@savvy-web/bundler`, `@savvy-web/silk`, and `@vitest-agent/plugin` with the rest auto-installed as peers.

The v4/v3 toolchain split is held by each package declaring `@effect/tsgo` (`catalog:effect`) as its typechecker devDependency rather than `@typescript/native-preview` (`catalog:silk`). What matters is the **declaration**, not the binary: it makes the typechecker's own `effect` peer ride the v4 catalog instead of the silk (v3-tooling) catalog. Under `autoInstallPeers: true` that stops the auto-installed `effect` peers in the tooling chain from resolving the workspace-preferred v4 into v3-wanting importers. This leans on current pnpm resolver behaviour and is **temporary**, pending upstream patch pnpm/pnpm#12847 (approved, expected to land shortly). See the peer-closure discipline in `@./.claude/design/effected/effect-standards.md`.

Source `package.json` files are `"private": true` — this is intentional. The bundler's `publishConfig`-driven transform produces the publishable manifest at build time; never set `"private": false` in source.

## Commands

```bash
pnpm lint                  # Check code with Biome (lint:fix, lint:fix:unsafe)
pnpm lint:md               # Check markdown with markdownlint (lint:md:fix)
pnpm typecheck             # Type-check via Turbo (runs tsgo per package)
pnpm test                  # Run all tests (test:watch, test:coverage)
pnpm build                 # Build dev + prod outputs via Turbo
pnpm dev                   # Run the docs website locally (preview to serve build)
```

Run a specific test file with `pnpm vitest run <path>`.

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
- **Markdownlint**: config at `lib/configs/.markdownlint-cli2.jsonc`; runs with `"fix": true`.
- **Husky hooks**: `pre-commit` runs lint-staged; `commit-msg` runs commitlint; `post-checkout` / `post-commit` / `post-merge` maintain file modes and script exec bits.

## Conventions

### Imports

- Use `.js` extensions for relative imports (ESM requirement).
- Use `node:` protocol for Node.js built-ins.
- Separate type imports: `import type { Foo } from './bar.js'`.

### Dependencies

Shared dependency versions come from pnpm catalogs in `pnpm-workspace.yaml` (`catalog:effect`, `catalog:effectPeers`, `catalog:silk`), managed via `packages/pnpm-plugin-effect`.

Treat new `pnpm peers check` warnings as upstream closure defects to fix, not warnings to silence. The residual `effect` peer warnings from transitive v3-wanting dependencies (`@effect/platform-node`, `@effect/sql-sqlite-node`) are **expected** under the interim setup — do not chase them. A warning outside that known set is a genuine defect.

Always check the lockfile diff after an install: a plain `pnpm install` once stripped turbo / biome / tsgo platform binaries from it.

### Commits

All commits require conventional commit format (`feat`, `fix`, `chore`, ...) and a DCO signoff (`Signed-off-by: Name <email>`).

Commit bodies are **plain prose** — no backticks, bullets, or code spans (`silk/body-no-markdown`). `design:` is not a valid commit type.

## Testing

- **Framework**: [Vitest](https://vitest.dev/) with the `@vitest-agent/plugin` `AgentPlugin` (project discovery, agent-friendly output, v8 coverage with `basic` thresholds); pool is `forks`.
- **Effect code**: test with `@effect/vitest` (`catalog:effect`), and assert with `assert.*` — **never `expect`**.
- **Location**: tests live in each package's `__test__/` directory, never co-located in `src/` (unit: `*.test.ts`; e2e: `e2e/*.e2e.test.ts`; integration: `integration/*.int.test.ts`).
- **CI**: `pnpm ci:test` sets `CI=true`.
