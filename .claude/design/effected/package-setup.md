---
status: current
module: effected
category: architecture
created: 2026-07-07
updated: 2026-07-07
last-synced: 2026-07-07
completeness: 90
related:
  - architecture.md
  - effect-standards.md
  - migration-playbook.md
---

# Package setup

## Overview

How to scaffold a new workspace package in the monorepo. This is the durable scaffold reference — it inherits the role the now-removed `packages/effect4` testbed played as the living "how to add a package" example. A new package `packages/X` (npm name `@effected/X`) mirrors the existing pure-tier libraries: [`packages/semver`](../../../packages/semver), [`packages/jsonc`](../../../packages/jsonc) and [`packages/yaml`](../../../packages/yaml). Copy a sibling and rename rather than build from scratch. This doc records the file manifest and the load-bearing choices; the sibling packages are authoritative about exact file contents.

## File manifest

A pure-tier package is these files under `packages/X/`. Where a file is byte-identical across packages, copy it from a sibling rather than hand-writing it.

- `package.json` — library manifest; see [package.json shape](#packagejson-shape).
- `tsconfig.json` — `{ "$schema": "https://json.schemastore.org/tsconfig.json", "extends": "@savvy-web/bundler/tsconfig/ecma.json" }`. Identical across packages.
- `turbo.json` — `{ "$schema": "https://turborepo.com/schema.v2.json", "extends": ["//"], "tasks": { "build:prod": { "outputs": ["$TURBO_EXTENDS$", "../../website/lib/models/X"] } } }`. The `outputs` model path must be the package's OWN name (`.../models/X`). effect4's copy carried a copy-paste bug pointing at `models/semver` — do not propagate it; every model path is per-package.
- `tsdoc.json` — copy verbatim from a sibling ([`packages/jsonc/tsdoc.json`](../../../packages/jsonc/tsdoc.json)); it is the standard `supportForTags` allow-list and does not vary per package.
- `savvy.build.ts` — `import { build } from "@savvy-web/bundler"; await build({ meta: { localPaths: ["../../website/lib/models/X"] } });`. The `localPaths` entry is per-package, same rename rule as `turbo.json`.
- `LICENSE` — copy from a sibling.
- `src/index.ts` — the public entrypoint, re-exports only (see the no-barrel rule in [effect-standards.md](effect-standards.md)).
- `__test__/` — tests live here per repo convention, never co-located in `src/`.

## package.json shape

Mirror [`packages/yaml/package.json`](../../../packages/yaml/package.json) as the canonical template and change only the package-specific fields. Load-bearing details and the parts easy to get wrong:

- `name` `@effected/X`, `version` `0.0.0`, `type` `module`, `sideEffects` `false` for pure libraries.
- `private: true` is deliberate — the bundler's `publishConfig`-driven transform produces the publishable manifest at build time. NEVER set `private: false` in source (see the Build Pipeline note in the root `CLAUDE.md`).
- `repository.directory` must be `packages/X` — a per-package field that is easy to leave pointing at the copied sibling.
- `exports`: `{ ".": "./src/index.ts", "./package.json": "./package.json" }`.
- `scripts`: `build:dev` = `node savvy.build.ts --target dev`, `build:prod` = `node savvy.build.ts --target prod`, `types:check` = `tsgo --noEmit`.
- `devDependencies`: `@effect/vitest`, `@effect/tsgo`, `effect` at `catalog:effect`; `@types/node`, `typescript` at `catalog:silk`.
- `peerDependencies`: `effect` at `catalog:effect` — libraries keep `effect` as a peer.
- `engines`: `node >=24.11.0`.
- `publishConfig`: `{ access: public, directory: dist/dev/pkg, linkDirectory: true, targets: { npm: true } }`.

## The load-bearing toolchain choice: @effect/tsgo

Each package declares `@effect/tsgo: catalog:effect` (which provides the `tsgo` binary used by `types:check`) INSTEAD OF the older `@typescript/native-preview: catalog:silk`. Keeping the typechecker in the `effect` (v4) catalog rather than the `silk` (v3-tooling) catalog is what lets the workspace run with `autoInstallPeers: true` without the v4 `effect` beta poisoning the v3 build toolchain. This is the crux of the current peer setup — see the peer-discipline section in [effect-standards.md](effect-standards.md) for the full mechanism and its temporary nature.

## Workspace wiring

Wiring is mostly automatic once the files exist:

- The `packages/*` glob in `pnpm-workspace.yaml` picks the package up — no manual registration.
- Catalogs referenced (`catalog:effect` for `effect`/`@effect/vitest`/`@effect/tsgo`, `catalog:silk` for `@types/node`/`typescript`) live in `pnpm-workspace.yaml`. `@effect/tsgo` sits in both the `effect` and `effectPeers` catalogs.
- The api-extractor model is wired by the `turbo.json` `outputs` entry plus the `savvy.build.ts` `localPaths` (both `../../website/lib/models/X`); the generated model under `website/lib/models/X` is committed. Website docs pages are a separate, later step (migration-playbook step 5).

## Steps to add a package

1. Create `packages/X/{src,__test__}` and the files above. Copy `tsdoc.json` and `LICENSE` verbatim from a sibling; set the `name`, `repository.directory` and both model paths (`turbo.json` outputs and `savvy.build.ts` localPaths) to `X`.
2. `pnpm install`, then CHECK `git diff pnpm-lock.yaml`. A plain install has once stripped optional platform binaries (turbo/biome/tsgo) from the lockfile; confirm the diff is only the new importer, not mass `optional: true` deletions.
3. Verify: `pnpm --filter @effected/X run types:check`; `turbo run build:prod --filter=@effected/X` with a zero-warning `dist/prod/issues.json`; biome and tests green.

## Relationship to migration

Scaffolding is step 2's mechanical half in the [migration-playbook.md](migration-playbook.md) flywheel — the design doc is written first, then the package is scaffolded and ported. This doc covers the package skeleton; the playbook covers the end-to-end port and the [package-inventory.md](package-inventory.md) tracks which package is next.
