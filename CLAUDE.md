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

Fifteen packages are merged: `semver`, `jsonc`, `yaml`, `package-json`, `npm`, `config-file`, `walker`, `glob`, `toml`, `lockfiles`, `store`, `xdg`, `runtime-resolver`, `runtime-resolver-cli`, `workspaces`.

**The config-file consolidation is done.** `config-file-jsonc`, `config-file-yaml` and `config-file-toml` are deleted; `@effected/config-file` absorbed their three codecs. The `jsonc`, `yaml` and `toml` **format** packages stay independent and untouched. The workspace is now 16 packages, down from 19. The four codecs are **free-standing named exports** — `JsonCodec`, `JsoncCodec`, `YamlCodec`, `TomlCodec`, one module each — and `ConfigCodec` is the interface only. **Never collect them into a namespace object**: referencing one reaches every codec, every codec reaches its parsing engine, and a JSON-only consumer drags the JSONC/YAML/TOML engines into their bundle. Tree-shaking dies silently. A namespace object is a barrel with different syntax; do not reintroduce one. Read `@./.claude/design/effected/packages/config-file.md` before touching it.

Two pieces of work remain, in this order: **ts-vfs → app-kit**.

1. **`@effected/ts-vfs`** (renamed from `@effected/type-registry` on 2026-07-11) is the next migration: it is the last package with real domain logic to port and is load-bearing for two of the five gate applications. It fetches, caches and resolves TypeScript type definitions from npm so Twoslash-style tooling can typecheck type-aware samples, and it wraps `@typescript/vfs` — hence the name. The v3 source package keeps its own name, `type-registry-effect`.
2. **app-kit** is last because it is a thin composition over `xdg` + `config-file` + `store` whose content is decided by how consumers actually wire the kit, so it absorbs the ts-vfs port's wiring rather than guessing at it. No consumer is blocked on it, because nothing may depend on it — a library taking an application control plane would be an R2 tier-3 leak.

`@effected/json-schema` is off the roadmap entirely. `package-inventory.md` and `releases.md` are authoritative — read them before starting work.

## Repository Layout

- `packages/` — the workspace packages (see below).
- `plugin/` — "effective", a Claude Code plugin (11 skills, 3 agents: `effect-developer`, `effect-reviewer`, `effect-migrator`) dogfooded during migrations; in development.
- `website/` — RSPress docs site; per-package api-extractor models live in `website/lib/models/`.
- `repos/effect-smol` — read-only vendored Effect v4 source (see below).
- `.claude/skills/improve` — project-level skill that maintains `plugin/skills/`.

### Package context files

Each package has its own `CLAUDE.md` and documents itself. Read it before working there; do not duplicate its content here. Parenthetical tags mark each package's tier in the three-tier taxonomy (pure / boundary / integrated) defined in `effect-standards.md`.

- `semver` — strict SemVer 2.0.0 schemas; the repo's DX north star (pure).
- `jsonc` — zero-dependency JSONC parse/edit/format schemas (pure).
- `yaml` — zero-dependency YAML 1.2 parse/edit/format schemas; largest package in the repo (pure).
- `package-json` — package.json schemas, validation and file IO (integrated).
- `npm` — dependency-resolution contracts for `catalog:` / `workspace:` specifiers (pure).
- `config-file` — composable config file loading: codec × resolver × strategy, with the four codecs (`JsonCodec`, `JsoncCodec`, `YamlCodec`, `TomlCodec`) as free-standing named exports (boundary). Zero *external* runtime dependencies; it peers on the `jsonc`, `yaml` and `toml` format packages.
- `walker` — upward path traversal; the one absorbing loop (boundary).
- `glob` — the full minimatch dialect as pure string→predicate schemas; vendored, hardened engine (pure).
- `toml` — TOML 1.0.0 parse/edit/format schemas on a from-scratch engine; first format package with no vendored code (pure).
- `lockfiles` — bun/npm/pnpm/yarn lockfile parsers normalized into one `Lockfile` model, plus pure integrity checking (pure).
- `store` — durable local state: a migrated, schema-versioned SQLite `Store` and a TTL `Cache` with tag invalidation and eviction (integrated).
- `xdg` — XDG Base Directory resolution: `AppDirs`, `NativeDirs`, `XdgPaths` and the config-file resolvers, over `@effected/walker` (boundary).
- `workspaces` — monorepo tooling: discovery, the dependency graph, package-manager detection, pnpm catalogs, lockfile IO and git change detection; implements `@effected/npm`'s resolver contracts (integrated).
- `runtime-resolver` — resolve semver-compatible Node, Bun and Deno versions from live feeds with an offline snapshot (boundary).
- `runtime-resolver-cli` — the `runtime-resolver` binary; separate so the library's consumers never install `@effect/platform-node` (integrated).
- `pnpm-plugin-effect` — pnpm catalog/config plugin; repo infrastructure, not a library migration, so the tier taxonomy does not apply. It is the one package **not** bound to the kit's coordinated `0.1.0` release: it may publish on its own schedule, as an optional convenience letting users pin their `effect` dependencies and peer floors the way this repo does. It is **not published yet** — like everything here it is `0.0.0` and `"private": true`. Never describe it as available on npm.

### repos/effect-smol

A `git subtree` of Effect-TS/effect-smol, pinned to the tag matching the `effect` catalog (`effect@4.0.0-beta.94`). It is vendored as **read-only Effect v4 source for agents** — the authority on what v4 actually exports.

It is excluded from pnpm (not a workspace package), turbo, vitest, Biome (`"includes": ["!repos"]`) and markdownlint (`"ignores": ["**/repos/**"]`).

**Never point a writing tool at it.** Never write to `repos/effect-smol` by any means.

Re-pin when the catalog bumps. This repo allows no merge commits and `git subtree pull` creates one, so the pull is followed by a squash:

```bash
git subtree pull --prefix=repos/effect-smol <url> effect@<tag> --squash
git reset --soft HEAD~2   # drop the merge commit and the squashed-content commit
git commit --no-verify    # carry the git-subtree-dir / git-subtree-split trailers forward
```

The trailers are load-bearing: `git subtree pull` locates the vendored tree by grepping ancestor commit messages for `git-subtree-dir`, so dropping them leaves the *next* re-pin with no split point. `--no-verify` because lint-staged would otherwise process ~2,000 vendored files. Full recipe: [architecture.md](.claude/design/effected/architecture.md#re-pinning-when-the-effect-catalog-bumps).

## Build Pipeline

[Turbo](https://turbo.build/) orchestrates builds across workspace packages: `pnpm build` runs `turbo run build:dev build:prod`. Each package builds with `node savvy.build.ts` using [@savvy-web/bundler](https://github.com/savvy-web/bundler), producing `dist/dev/` and `dist/prod/` outputs. Task graph: `build:prod` depends on `types:check` and `build:dev`; both depend on upstream `^build:dev`.

**Never run `node savvy.build.ts --target prod` directly.** It skips `build:dev`, emits no `.d.ts`, and leaves a truncated `issues.json` shaped exactly like a clean gate. Build through `pnpm build --filter <pkg>`.

`@savvy-web/bundler` is a **`devDependency` of every package that builds** — it is what `savvy.build.ts` imports. **Never put it in `dependencies`**, or the publishable manifest ships a build tool at runtime. The workspace sets `autoInstallPeers: true`, so root `devDependencies` are just `@savvy-web/silk` and `@vitest-agent/plugin`, with the rest auto-installed as peers.

**Keep `@effect/tsgo` (`catalog:effect`) as each package's typechecker devDependency** — never swap it for `@typescript/native-preview` (`catalog:silk`). The declaration, not the binary, is what holds the v4/v3 toolchain split.

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
- **Markdownlint**: config at `lib/configs/.markdownlint-cli2.jsonc`. Check with `pnpm lint:md`, fix with `pnpm lint:md:fix`.
- **Husky hooks**: `pre-commit` runs lint-staged; `commit-msg` runs commitlint; `post-checkout` / `post-commit` / `post-merge` maintain file modes and script exec bits.

**Never invoke `markdownlint-cli2` directly — run `pnpm lint:md` or `pnpm lint:md:fix`.** The tool *merges* explicit path arguments with the config's repo-wide `globs` rather than narrowing to them, so "lint just my file" lints every markdown file in the repo. The config therefore omits `fix` entirely: present, it overrides the `--fix` flag in both directions; absent, the flag decides.

**Never run `git checkout` / `git restore` / `git stash` to undo unexpected working-tree changes.** Other agents and earlier steps hold uncommitted work there. Inspect the diff and repair what is actually wrong.

## Conventions

### Imports

- Use `.js` extensions for relative imports (ESM requirement).
- Use `node:` protocol for Node.js built-ins.
- Separate type imports: `import type { Foo } from './bar.js'`.

### Dependencies

Shared dependency versions come from pnpm catalogs in `pnpm-workspace.yaml` (`catalog:effect`, `catalog:effectPeers`, `catalog:silk`), managed via `packages/pnpm-plugin-effect`.

**Pin Effect catalogs to exact beta versions** (`4.0.0-beta.94`, never a caret). A caret on a prerelease floats across the beta line and silently desynchronizes the installed `effect` from the `repos/effect-smol` subtree that is supposed to be the authority on what v4 exports.

**Two pins look redundant and are not. Never delete either:**

- The **`overrides`** entry in `pnpm-workspace.yaml` pinning `@effect/platform-node@4.0.0-beta.94>@effect/platform-node-shared` to `4.0.0-beta.94`. Keep it **scoped to the v4 parent**; an unscoped override poisons the v3 tooling chain in the opposite direction.
- **`website` declares `effect: catalog:silk`** (v3). Removing it re-breaks the docs site (`Context.GenericTag` disappears under a v4 core).

**Treat new `pnpm peers check` warnings as upstream closure defects to fix, not warnings to silence.** One residual is **expected and must not be chased**: `@effect/platform`, `@effect/rpc`, `@effect/sql` and `@effect/cluster` wanting `effect@^3.21.x` through the build/test tooling chain. Any warning outside that set is a genuine defect.

**Always check the lockfile diff after an install** — a plain `pnpm install` once stripped turbo / biome / tsgo platform binaries from it.

Why each of these holds (the `autoInstallPeers` mechanics, the caret-on-a-prerelease float one level down, the `type-registry-effect` peer that poisoned the website) → `@./.claude/design/effected/architecture.md`. Load when: editing catalogs, `overrides`, peer declarations, or the website's dependencies.

### Commits

All commits require conventional commit format (`feat`, `fix`, `chore`, ...) and a DCO signoff (`Signed-off-by: Name <email>`).

Commit bodies are **plain prose** — no backticks, bullets, or code spans (`silk/body-no-markdown`). `design:` is not a valid commit type.

## Testing

- **Framework**: [Vitest](https://vitest.dev/) with the `@vitest-agent/plugin` `AgentPlugin` (project discovery, agent-friendly output, v8 coverage with `basic` thresholds); pool is `forks`.
- **Effect code**: test with `@effect/vitest` (`catalog:effect`), and assert with `assert.*` — **never `expect`**.
- **Location**: tests live in each package's `__test__/` directory, never co-located in `src/` (unit: `*.test.ts`; e2e: `e2e/*.e2e.test.ts`; integration: `integration/*.int.test.ts`).
- **CI**: `pnpm ci:test` sets `CI=true`.
