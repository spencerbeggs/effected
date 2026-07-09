# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

This is **effected**, a pnpm monorepo (npm org `@effected`) that consolidates Spencer's `*-effect` Effect-ecosystem libraries into a single repo. Each library is redesigned Effect v4-first (tracking v4 betas via the `effect` catalog in `pnpm-workspace.yaml`) rather than lifted-and-shifted from its v3 repo. The monorepo holds libraries only — applications stay in external repos. No packages have been released to npm yet.

## Design Documentation

Six foundational design docs live in `.claude/design/effected/` (config: `.claude/design/design.config.json`). Load them on demand:

- Architecture → `@./.claude/design/effected/architecture.md` — Load when: changing repo structure, build pipeline, tooling, or workspace/catalog setup.
- Effect standards → `@./.claude/design/effected/effect-standards.md` — Load when: designing or porting a library API, or making dependency/peer-closure decisions.
- Package inventory → `@./.claude/design/effected/package-inventory.md` — Load when: picking the next migration target or updating a package's migration status.
- Migration playbook → `@./.claude/design/effected/migration-playbook.md` — Load when: starting or continuing a package migration.
- Package setup → `@./.claude/design/effected/package-setup.md` — Load when: scaffolding or adding a new workspace package.
- Plugin → `@./.claude/design/effected/plugin.md` — Load when: working in `plugin/` on the "effective" Claude Code plugin.

### Migration Workflow

Migrations happen one package at a time per the migration playbook: write the package's design doc first, then port. `@effected/semver` landed first, `@effected/jsonc` second, `@effected/yaml` third, and `@effected/package-json` fourth (the first boundary-tier port, which also spun out the internal `@effected/npm` sibling); `@effected/config-file` landed fifth (the second boundary-tier port) and, because this monorepo does not use subpath exports, expanded into a family with `@effected/config-file-jsonc` and `@effected/config-file-yaml` codec adapters. `@effected/toml` (a new internal package, no source repo) queues next, followed by `@effected/config-file-toml` and `@effected/config-file-watcher`; the order after firms up as lessons land.

## Repository Layout

- `packages/semver` — first migrated library: strict SemVer 2.0.0 schemas (pure tier).
- `packages/jsonc` — second migrated library: zero-dependency JSONC parse/edit/format schemas (pure tier).
- `packages/yaml` — third migrated library: YAML parse/edit/format schemas over an internal engine plus public modules (Yaml facade, YamlDiagnostic, YamlNode, YamlDocument, YamlEdit, YamlFormat, YamlVisitor) (pure tier).
- `packages/package-json` — fourth migrated library and first boundary-tier port: package.json schemas (`Package` Schema.Class, dependency-specifier taxonomy, semantic field decoding) with IO confined to a single `PackageJsonFile.ts` module (boundary tier).
- `packages/npm` — internal sibling (no source repo) spun out of the package-json port: dependency-resolution service contracts (`CatalogResolver`, `WorkspaceResolver`, `DependencyResolutionError`) (pure tier).
- `packages/config-file` — fifth migrated library and second boundary-tier port: composable config file loading (codec × resolver × strategy pipeline, per-schema `Context.Service` factory, tagged errors, PubSub events, `EncryptedCodec`, `ConfigMigration`, v4 `ConfigProvider` integration) (boundary tier).
- `packages/config-file-jsonc` — codec adapter over `@effected/jsonc` for `@effected/config-file` (pure tier).
- `packages/config-file-yaml` — codec adapter over `@effected/yaml` for `@effected/config-file` (pure tier).
- `packages/pnpm-plugin-effect` — repo infrastructure, not a library migration: pnpm catalog/config plugin (built with `rolldown-pnpm-config`; `pnpm pnpm:export` / `pnpm:preview` / `pnpm:up`).
- `plugin/` — "effective", a Claude Code plugin (skills + effect-dev agent) dogfooded during migrations; in development.
- `website/` — RSPress docs site; per-package api-extractor models live in `website/lib/models/`.

## Build Pipeline

[Turbo](https://turbo.build/) orchestrates builds across workspace packages: `pnpm build` runs `turbo run build:dev build:prod`. Each package builds with `node savvy.build.ts` using [@savvy-web/bundler](https://github.com/savvy-web/bundler), producing `dist/dev/` and `dist/prod/` outputs. Task graph: `build:prod` depends on `types:check` and `build:dev`; both depend on upstream `^build:dev`.

`@savvy-web/bundler` lives in the **root** `devDependencies` deliberately — package `savvy.build.ts` scripts resolve it via Node's upward `node_modules` walk; do not move it into package `devDependencies`. The workspace runs `autoInstallPeers: true` + `dedupePeerDependents: false` in `pnpm-workspace.yaml`, so root `devDependencies` collapse to `@savvy-web/bundler`, `@savvy-web/silk`, and `@vitest-agent/plugin` with the rest auto-installed as peers. The v4/v3 toolchain split is held by each package using `@effect/tsgo` (`catalog:effect`) as its typechecker rather than `@typescript/native-preview` (`catalog:silk`). This leans on a pnpm resolver quirk and is temporary, pending upstream patch pnpm/pnpm#12847 — see the peer-closure discipline in `@./.claude/design/effected/effect-standards.md` for why.

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

## Tooling

The `@savvy-web/*` packages are in active development — if behavior seems unexpected, read the installed source in `node_modules/@savvy-web/`.

- **@savvy-web/bundler** — build pipeline, dual outputs, package.json transform (see Build Pipeline).
- **@savvy-web/silk** — meta-package providing Biome config, commitlint/lint-staged presets, markdownlint custom rules, and tsconfig bases. Root `tsconfig.json` extends `@savvy-web/silk/tsconfig/node/root.json`.

### Code Quality and Hooks

- **Biome**: `biome.jsonc` extends `@savvy-web/silk/biome`.
- **Commitlint**: `lib/configs/commitlint.config.ts` uses `CommitlintConfig.silk()`.
- **Lint-staged**: `lib/configs/lint-staged.config.ts` uses `Preset.silk()`.
- **Markdownlint**: config at `lib/configs/.markdownlint-cli2.jsonc`.
- **Husky hooks**: `pre-commit` runs lint-staged; `commit-msg` runs commitlint; `post-checkout` / `post-commit` / `post-merge` maintain file modes and script exec bits.

## Conventions

### Imports

- Use `.js` extensions for relative imports (ESM requirement).
- Use `node:` protocol for Node.js built-ins.
- Separate type imports: `import type { Foo } from './bar.js'`.

### Dependencies

Shared dependency versions come from pnpm catalogs in `pnpm-workspace.yaml` (`catalog:effect`, `catalog:effectPeers`, `catalog:silk`), managed via `packages/pnpm-plugin-effect`. Treat new `pnpm peers check` warnings as upstream closure defects to fix, not warnings to silence.

### Commits

All commits require conventional commit format (`feat`, `fix`, `chore`, ...) and a DCO signoff (`Signed-off-by: Name <email>`).

## Testing

- **Framework**: [Vitest](https://vitest.dev/) with the `@vitest-agent/plugin` `AgentPlugin` (project discovery, agent-friendly output, v8 coverage with `basic` thresholds); pool is `forks`.
- **Effect code**: test with `@effect/vitest` (`catalog:effect`).
- **Location**: tests live in each package's `__test__/` directory, never co-located in `src/` (unit: `*.test.ts`; e2e: `e2e/*.e2e.test.ts`; integration: `integration/*.int.test.ts`).
- **CI**: `pnpm ci:test` sets `CI=true`.
