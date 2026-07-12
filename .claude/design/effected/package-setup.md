---
status: current
module: effected
category: architecture
created: 2026-07-07
updated: 2026-07-12
last-synced: 2026-07-12
completeness: 92
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
- `src/index.ts` — the public entrypoint, re-exports only (see the no-barrel rule in [effect-standards.md](effect-standards.md)). Create it as a stub **before the first install** — see [scaffold order](#scaffold-order-stub-srcindexts-before-the-first-install).
- `__test__/` — tests live here per repo convention, never co-located in `src/`.

## Scaffold order: stub src/index.ts before the first install

A half-scaffolded package — a `package.json` on disk with no `src/index.ts` yet — breaks **every `pnpm run` in the repo**, not just its own. The chain: once the directory has a manifest, the `packages/*` glob makes it a workspace package; any `pnpm run <script>` anywhere triggers pnpm's verify-deps check; that runs a full install; the install runs every workspace package's `prepare` script; and the new package's `prepare` (`turbo run build:dev`) fails because the entrypoint its build resolves does not exist. Every script invocation repo-wide fails until the stub exists, and the error surfaces far from its cause — you run tests in an unrelated package and get a build failure in the one you are scaffolding.

So the scaffold order is load-bearing:

1. `package.json` + `tsconfig.json` + a **stub `src/index.ts`** (an empty file or a single `export {}` is enough — it only has to resolve).
2. The first `pnpm install`.
3. The real modules.

Learned on the `@effected/app` port (2026-07-12). **The rule is unconditional** — it is not limited to packages with sibling `@effected/*` dependencies. Every library package's manifest carries `prepare: turbo run build:dev` (17 of the 18 packages; `pnpm-plugin-effect`, the companion, is the lone exception, and nobody scaffolds a library from it), including pure leaves like `semver` and `jsonc` that have no `workspace:*` edge at all. So a scaffold copied from ANY library sibling inherits the script, and `prepare` is what install runs. Stub the entrypoint first regardless of what the new package depends on.

## package.json shape

Mirror [`packages/yaml/package.json`](../../../packages/yaml/package.json) as the canonical template and change only the package-specific fields. Load-bearing details and the parts easy to get wrong:

- `name` `@effected/X`, `version` `0.0.0`, `type` `module`, `sideEffects` `false` for pure libraries.
- `private: true` is deliberate — the bundler's `publishConfig`-driven transform produces the publishable manifest at build time. NEVER set `private: false` in source (see the Build Pipeline note in the root `CLAUDE.md`).
- `repository.directory` must be `packages/X` — a per-package field that is easy to leave pointing at the copied sibling.
- `homepage` must be `https://github.com/spencerbeggs/effected/tree/main/packages/X#readme`. The `/tree/main/` segment is **load-bearing**: the shorter `https://github.com/spencerbeggs/effected/packages/X#readme` form 404s (GitHub reads `/packages/` as a repo route, not a path), and it was swept repo-wide on 2026-07-12 (PR #73 review finding). Per-package field — easy to leave pointing at the copied sibling.
- `exports`: `{ ".": "./src/index.ts", "./package.json": "./package.json" }`.
- `scripts`: `build:dev` = `node savvy.build.ts --target dev`, `build:prod` = `node savvy.build.ts --target prod`, `types:check` = `tsc --noEmit`. A package that depends on a sibling `@effected/*` package via `workspace:*` ALSO needs `prepare` = `turbo run build:dev` — see [cross-package build dependencies](#cross-package-build-dependencies).
- `devDependencies`: `@savvy-web/bundler` (a plain semver range, currently `^1.1.11` — it is not catalogued); `@effect/vitest` and `effect` at `catalog:effect`; `@types/node` and `typescript` at `catalog:silk`. The bundler is what `savvy.build.ts` imports, so every package that builds declares it. It is a **`devDependency`** — never a `dependency`, even in a package that has a `dependencies` block, or the publishable manifest ships a build tool at runtime. `typescript` is the typechecker behind `types:check`; do **not** add `@effect/tsgo` (see [the typechecker](#the-typechecker-tsc-not-tsgo)).
- `peerDependencies`: `effect` at `catalog:effect` — libraries keep `effect` as a peer.
- `engines`: `node >=24.11.0`.
- `publishConfig`: `{ access: public, directory: dist/dev/pkg, linkDirectory: true, targets: { npm: true } }`.

## Cross-package build dependencies

`publishConfig.linkDirectory: true` (+ `directory: dist/dev/pkg`) means pnpm links a `workspace:*` `@effected/*` dependency into its consumer's `node_modules` **pointing at the dependency's `dist/dev/pkg`, not its source** (e.g. `node_modules/@effected/npm → ../../../npm/dist/dev/pkg`). So the dependency must be **built** before the consumer can import it — importing `@effected/npm` from an unbuilt sibling resolves to a dangling symlink. This does not bite a pure leaf package (nothing it imports needs building), but it breaks the consumer's tests in a fresh checkout where no `dist/dev/pkg` exists yet — CI runs `vitest run` across all packages against a clean install, so a package with sibling `@effected/*` deps fails to resolve them and its sibling-importing test files silently drop from collection.

The fix is the **`prepare` pattern**: any package with a `workspace:*` edge to another `@effected/*` package adds

```json
{ "scripts": { "prepare": "turbo run build:dev" } }
```

pnpm runs the workspace package's `prepare` on install (verified: a fresh/forced `pnpm install` fires `packages/X prepare$ turbo run build:dev`), and `turbo run build:dev` — scoped to that package — builds it **and its dependencies** in topological order via the `^build:dev` task edge, so every `dist/dev/pkg` the consumer links to exists before tests run. Strictly, only the **consumer** *needs* the script — a pure leaf's dependencies are built by the consumer's `turbo run build:dev` and it requires no `prepare` of its own. `@effected/package-json` is the first package to require it (it depends on `@effected/npm` and `@effected/semver`). In practice, though, **every library package carries it anyway** (17 of 18; all but `pnpm-plugin-effect`), leaves included. Do not read the necessity claim as a description of the tree — a copied scaffold inherits `prepare` whatever it depends on, which is why the [scaffold-order rule](#scaffold-order-stub-srcindexts-before-the-first-install) is unconditional.

## The typechecker: tsc, not tsgo

Every package typechecks with `tsc --noEmit`, backed by `typescript: catalog:silk`. **Do not add `@effect/tsgo` to a new package.**

This reverses earlier guidance. Each package once declared `@effect/tsgo: catalog:effect` (providing the `tsgo` binary) instead of `@typescript/native-preview: catalog:silk`, to keep the typechecker's own `effect` peer on the v4 catalog rather than the `silk` (v3-tooling) catalog. The pnpm peer-resolution bug that stood behind that choice was fixed upstream (pnpm 11.11.0, completed in 11.12.0), and `@effect/tsgo` was then removed from all packages in `chore: fix typescript versions` (d0599438). It survives only as a `pnpm-workspace.yaml` catalog entry with no consumer. Copying a sibling gets this right automatically; the note exists so nobody reintroduces it from memory. See the peer-discipline section in [effect-standards.md](effect-standards.md#verified-workspace-configuration).

## Workspace wiring

Wiring is mostly automatic once the files exist:

- The `packages/*` glob in `pnpm-workspace.yaml` picks the package up — no manual registration.
- Catalogs referenced (`catalog:effect` for `effect`/`@effect/vitest`, `catalog:silk` for `@types/node`/`typescript`) live in `pnpm-workspace.yaml`.
- The api-extractor model is wired by the `turbo.json` `outputs` entry plus the `savvy.build.ts` `localPaths` (both `../../website/lib/models/X`). The generated model under `website/lib/models/X` is a `build:prod` artifact, **not** committed — `.gitignore` ignores `website/lib/models/*`, and no package's model is tracked. Website docs pages are a separate, later step (migration-playbook step 5).

## Steps to add a package

1. Create `packages/X/{src,__test__}` and the files above, INCLUDING a stub `src/index.ts`. Copy `tsdoc.json` and `LICENSE` verbatim from a sibling; set the `name`, `homepage`, `repository.directory` and both model paths (`turbo.json` outputs and `savvy.build.ts` localPaths) to `X`. Do not stop halfway with a manifest and no entrypoint — that state breaks every `pnpm run` in the repo ([scaffold order](#scaffold-order-stub-srcindexts-before-the-first-install)).
2. `pnpm install`, then CHECK `git diff pnpm-lock.yaml`. A plain install has once stripped optional platform binaries (turbo/biome) from the lockfile; confirm the diff is only the new importer, not mass `optional: true` deletions.
3. Write the real modules.
4. Verify: `pnpm --filter @effected/X run types:check`; `pnpm build --filter @effected/X` with a zero-warning `dist/prod/issues.json` (never `node savvy.build.ts --target prod` directly — it skips `build:dev` and emits a truncated `issues.json` that looks clean); biome and tests green.

## Relationship to migration

Scaffolding is step 2's mechanical half in the [migration-playbook.md](migration-playbook.md) flywheel — the design doc is written first, then the package is scaffolded and ported. This doc covers the package skeleton; the playbook covers the end-to-end port and the [package-inventory.md](package-inventory.md) tracks which package is next.
