---
status: current
module: effected
category: architecture
created: 2026-07-07
updated: 2026-08-26
last-synced: 2026-08-26
completeness: 95
related:
  - catalog-sync.md
  - architecture.md
  - effect-standards.md
  - migration-playbook.md
  - package-inventory.md
---

# Package setup

## Overview

How to scaffold a new workspace package in the monorepo. This is the durable scaffold reference. A new package `packages/X` (npm name `@effected/X`) mirrors the existing pure-tier libraries: [`packages/semver`](../../../packages/semver), [`packages/jsonc`](../../../packages/jsonc) and [`packages/yaml`](../../../packages/yaml). Copy a sibling and rename rather than build from scratch. This doc records the file manifest and the load-bearing choices; the sibling packages are authoritative about exact file contents.

## File manifest

A pure-tier package is these files under `packages/X/`. Where a file is byte-identical across packages, copy it from a sibling rather than hand-writing it.

- `package.json` — library manifest; see [package.json shape](#packagejson-shape).
- `tsconfig.json` — `{ "$schema": "https://json.schemastore.org/tsconfig.json", "extends": "@savvy-web/bundler/tsconfig/ecma.json" }`. Identical across packages.
- `turbo.json` — `{ "$schema": "https://turborepo.com/schema.v2.json", "extends": ["//"], "tasks": { "build:prod": { "outputs": ["$TURBO_EXTENDS$", "../../website/lib/models/X"] } } }`. The `outputs` model path must be the package's OWN name (`.../models/X`) — a copy-paste sibling name here is an easy mistake, and every model path is per-package.
- `tsdoc.json` — copy verbatim from a sibling ([`packages/jsonc/tsdoc.json`](../../../packages/jsonc/tsdoc.json)); it is the standard `supportForTags` allow-list and does not vary per package.
- `savvy.build.ts` — `import { build } from "@savvy-web/bundler"; await build({ meta: { localPaths: ["../../website/lib/models/X"] } });`. The `localPaths` entry is per-package, same rename rule as `turbo.json`.
- `LICENSE` — copy from a sibling.
- `CLAUDE.md` — the package's own context file. Every package has one and it is where the package documents itself; the root `CLAUDE.md` deliberately does not duplicate it.
- `README.md` — the package's user-facing entry point, and what npm renders. Every package has one.
- `src/index.ts` — the public entrypoint, re-exports only (see the no-barrel rule in [effect-standards.md](effect-standards.md)). Create it as a stub **before the first install** — see [scaffold order](#scaffold-order-stub-srcindexts-before-the-first-install).
- `__test__/` — tests live here per repo convention, never co-located in `src/`.

## Scaffold order: stub src/index.ts before the first install

A half-scaffolded package — a `package.json` on disk with no `src/index.ts` yet — breaks **every `pnpm run` in the repo**, not just its own. The chain: once the directory has a manifest, the `packages/*` glob makes it a workspace package; any `pnpm run <script>` anywhere triggers pnpm's verify-deps check; that runs a full install; the install runs every workspace package's `prepare` script; and the new package's `prepare` (`turbo run build:dev`) fails because the entrypoint its build resolves does not exist. Every script invocation repo-wide fails until the stub exists, and the error surfaces far from its cause — you run tests in an unrelated package and get a build failure in the one you are scaffolding.

So the scaffold order is load-bearing:

1. `package.json` + `tsconfig.json` + a **stub `src/index.ts`** (an empty file or a single `export {}` is enough — it only has to resolve).
2. The first `pnpm install`.
3. The real modules.

**The rule is unconditional** — it is not limited to packages with sibling `@effected/*` dependencies. Every library package's manifest carries `prepare: turbo run build:dev` (`pnpm-plugin-effect`, the companion, is the lone exception, and nobody scaffolds a library from it), including pure leaves like `semver` and `jsonc` that have no `workspace:*` edge at all. So a scaffold copied from ANY library sibling inherits the script, and `prepare` is what install runs. Stub the entrypoint first regardless of what the new package depends on.

## package.json shape

Mirror [`packages/yaml/package.json`](../../../packages/yaml/package.json) as the canonical template and change only the package-specific fields. Load-bearing details and the parts easy to get wrong:

- `name` `@effected/X`, `version` `0.0.0`, `type` `module`, `sideEffects` `false` for pure libraries.
- `private: true` is deliberate — the bundler's `publishConfig`-driven transform produces the publishable manifest at build time. NEVER set `private: false` in source (see the Build Pipeline note in the root `CLAUDE.md`).
- `repository.directory` must be `packages/X` — a per-package field that is easy to leave pointing at the copied sibling.
- `homepage` must be `https://github.com/spencerbeggs/effected/tree/main/packages/X#readme`. The `/tree/main/` segment is **load-bearing**: the shorter `https://github.com/spencerbeggs/effected/packages/X#readme` form 404s (GitHub reads `/packages/` as a repo route, not a path). Per-package field — easy to leave pointing at the copied sibling.
- `exports`: `{ ".": "./src/index.ts", "./package.json": "./package.json" }`. A package that needs a second published entrypoint adds one key here and one entry file — see [a second published entrypoint](#a-second-published-entrypoint), which is not a free choice.
- `scripts`: `build:dev` = `node savvy.build.ts --target dev`, `build:prod` = `node savvy.build.ts --target prod`, `types:check` = `tsc --noEmit`. A package that depends on a sibling `@effected/*` package ALSO needs `prepare` = `turbo run build:dev` — see [cross-package build dependencies](#cross-package-build-dependencies).
- `devDependencies`: `@savvy-web/bundler` (a plain semver range, not catalogued); `@effect/vitest` and `effect` at `catalog:effect`; `@types/node` and `typescript` at `catalog:build`. The bundler is what `savvy.build.ts` imports, so every package that builds declares it. It is a **`devDependency`** — never a `dependency`, even in a package that has a `dependencies` block, or the publishable manifest ships a build tool at runtime. `typescript` is the typechecker behind `types:check`; do **not** add `@effect/tsgo` (see [the typechecker](#the-typechecker-tsc-not-tsgo)).
- `peerDependencies`: `effect` at `catalog:effect:peers` — libraries keep `effect` as a peer, and the peer declaration draws from the `effect:peers` catalog, not `effect` (which is what the `devDependencies` entry uses).
- Sibling `@effected/*` edges use `workspace:^`, whether they are dependencies or peers ([effect-standards.md](effect-standards.md#cross-effected-dependencies)). The one exception is the `devDependency` that satisfies an auto-installed peer: that stays `workspace:*`, because it is never published.
- `engines`: `node >=24.11.0`, matching every sibling and the root manifest.
- `publishConfig`: `{ access: public, directory: dist/dev/pkg, linkDirectory: true, targets: { npm: true } }`.

## A second published entrypoint

Most packages ship a single `.` entrypoint and the manifest shape above is all there is to it. Two do not — [`@effected/workspaces`](../../../packages/workspaces)' `./node-sync` and [`@effected/schema-org`](packages/schema-org.md#module-layout-and-the-two-entrypoints)'s `./validate` — and nothing recorded how a second one is wired, so this section does.

### What a second entrypoint costs and what it buys

**`"sideEffects": false` does not make a subpath unnecessary, and believing it does is the trap.** The two claims sound like the same claim and are not:

- For a **bundled** consumer, a re-export barrel tree-shakes correctly. The named exports stay individually reachable, so importing one class from `src/index.ts` retains only that class's graph. This is the case `sideEffects: false` describes, and it is why the [no-barrel rule](effect-standards.md#no-barrel-re-exports) permits entrypoints to re-export at all.
- For an **unbundled Node consumer** — a CLI, a test run, a server, anything running the published files directly — there is no tree-shaker. `import { TechArticle } from "@effected/schema-org"` evaluates `index.ts`, which evaluates every module it re-exports, which loads **the whole module graph** whether or not a single binding from it is read.

So a subpath entrypoint is the only mechanism that makes a heavy, optional part of a package cost zero for the consumers that do not use it. That is the entire justification, and it is a measurement rather than a preference: `schema-org` split `./validate` because the vocabulary table behind it is 74,834 B raw that a graph-only consumer would otherwise load on every import. **Quote the raw figure, not the gzip one** — parse cost is what an unbundled consumer pays.

The corollary is the test obligation. Review cannot enforce a reachability boundary, so a package with a split ships a **structural test asserting it, with a positive control**: assert that the light entrypoint's transitive module graph excludes the heavy module, *and* assert that the heavy entrypoint's includes it, so a test that has quietly stopped resolving anything fails instead of passing vacuously.

### The wiring

1. One extra `exports` key, e.g. `"./validate": "./src/conformance-entry.ts"`.
2. One entry file beside `src/index.ts`, re-exports only, carrying a `@packageDocumentation` block that says why the split exists.
3. Nothing else. Turbo, the bundler and the api-extractor model path are per-package, not per-entrypoint.

A type named by a second entrypoint's signatures must be exported **from that entrypoint**, not merely from `.`. Type-only re-exports (`export type { … }`) are erased at runtime and so cost the split nothing — but where API Extractor needs the **class** and not just its type (a class used as a parameter type of an exported function), the value re-export is required and is the honest cost of the split. Record which one it is and why, at the re-export site.

### The case-collision rule

**A subpath export key must not differ from a concept module's name only in case, and neither must the entry file.** This bites on a case-insensitive filesystem — which is every macOS dev machine — and it fails at *two* layers, the second of which reports the wrong file and the wrong symbol:

1. **Source layer.** `src/conformance.ts` beside `src/Conformance.ts` is a `tsc` error outright: **TS1149**, "differs from already included file name only in casing".
2. **Declaration layer.** Renaming the *source* file does not fix it, because the emitted declaration name derives from the **export key**. `"./conformance"` emits `conformance.d.ts`, which collides with the module's own `Conformance.d.ts`; the bundler sidesteps the collision by writing `conformance2.d.ts`, and API Extractor — still pointed at `conformance.d.ts` — resolves case-insensitively onto the **module** instead of the entry. The symptom is a **CI-fatal `ae-forgotten-export`** naming a symbol the entry visibly exports, which sends a reader hunting a missing export that is not missing.

This is a live trap rather than a curiosity, because the house convention is **PascalCase concept modules named for their API** ([file names are API names](effect-standards.md#module-layout-module-per-concept)), so any package growing a subpath named after one of its concepts walks straight into it. Two fixes exist and only one is correct:

- **Name the subpath for what it does, not for the class it happens to lead with**, and give the entry file a distinct name (`./validate` → `src/conformance-entry.ts`). This is the fix. It usually produces a better key anyway — `./validate` describes the entry's whole contents where `./conformance` described one of its exports.
- **Renaming the concept module** to dodge the collision is the wrong fix: it sacrifices the API-name convention to a build-tool artifact.

## Cross-package build dependencies

`publishConfig.linkDirectory: true` (+ `directory: dist/dev/pkg`) means pnpm links a workspace `@effected/*` dependency into its consumer's `node_modules` **pointing at the dependency's `dist/dev/pkg`, not its source** (e.g. `node_modules/@effected/npm → ../../../npm/dist/dev/pkg`). So the dependency must be **built** before the consumer can import it — importing `@effected/npm` from an unbuilt sibling resolves to a dangling symlink. This does not bite a pure leaf package (nothing it imports needs building), but it breaks the consumer's tests in a fresh checkout where no `dist/dev/pkg` exists yet — CI runs `vitest run` across all packages against a clean install, so a package with sibling `@effected/*` deps fails to resolve them and its sibling-importing test files silently drop from collection.

The fix is the **`prepare` pattern**: any package with a workspace edge to another `@effected/*` package adds

```json
{ "scripts": { "prepare": "turbo run build:dev" } }
```

pnpm runs the workspace package's `prepare` on install, and `turbo run build:dev` — scoped to that package — builds it **and its dependencies** in topological order via the `^build:dev` task edge, so every `dist/dev/pkg` the consumer links to exists before tests run. Strictly, only the **consumer** *needs* the script — a pure leaf's dependencies are built by the consumer's `turbo run build:dev` and it requires no `prepare` of its own. In practice **every library package carries it anyway** (all but the companion `pnpm-plugin-effect`), leaves included. Do not read the necessity claim as a description of the tree — a copied scaffold inherits `prepare` whatever it depends on, which is why the [scaffold-order rule](#scaffold-order-stub-srcindexts-before-the-first-install) is unconditional.

## The typechecker: tsc, not tsgo

Every package typechecks with `tsc --noEmit`, backed by `typescript: catalog:build`. **Do not add `@effect/tsgo` to a new package.** It survives only as a `pnpm-workspace.yaml` catalog entry with no consumer. Copying a sibling gets this right automatically; the note exists so nobody reintroduces it from memory. See the peer-discipline section in [effect-standards.md](effect-standards.md#verified-workspace-configuration).

## Workspace wiring

Wiring is mostly automatic once the files exist:

- The `packages/*` glob in `pnpm-workspace.yaml` picks the package up — no manual registration.
- The Effect catalogs (`catalog:effect` for the `effect`/`@effect/vitest` devDependencies, `catalog:effect:peers` for the `effect` peer) live in `pnpm-workspace.yaml`. `catalog:build`, which supplies `@types/node` and `typescript`, does **not** — the `@savvy-web/pnpm-plugin-silk` config dependency injects it ([architecture.md](architecture.md#the-catalogs-pin-exact-versions)).
- **The `effected` catalog is not automatic.** A new publishable package must be added to the `effected` catalog literal in `packages/pnpm-plugin-effect/savvy.build.ts` and to that package's `turbo.json` build `inputs` lists (both `build:dev` and `build:prod`). The plugin's catalog test asserts the catalog covers every package whose manifest has `publishConfig.access === "public"`, so skipping this turns a scaffold into a failing test suite. `pnpm catalog:sync` does the rewrite ([catalog-sync.md](catalog-sync.md)).
- The api-extractor model is wired by the `turbo.json` `outputs` entry plus the `savvy.build.ts` `localPaths` (both `../../website/lib/models/X`). The generated model under `website/lib/models/X` is a `build:prod` artifact, **not** committed — `.gitignore` ignores `website/lib/models/*`, and no package's model is tracked. Website docs pages are a separate, later step (migration-playbook step 5).

## Steps to add a package

1. Create `packages/X/{src,__test__}` and the files above, INCLUDING a stub `src/index.ts`. Copy `tsdoc.json` and `LICENSE` verbatim from a sibling; set the `name`, `homepage`, `repository.directory` and both model paths (`turbo.json` outputs and `savvy.build.ts` localPaths) to `X`. Do not stop halfway with a manifest and no entrypoint — that state breaks every `pnpm run` in the repo ([scaffold order](#scaffold-order-stub-srcindexts-before-the-first-install)).
2. `pnpm install`, then CHECK `git diff pnpm-lock.yaml`. A plain install has once stripped optional platform binaries (turbo/biome) from the lockfile; confirm the diff is only the new importer, not mass `optional: true` deletions.
3. Write the real modules.
4. Verify: `pnpm --filter @effected/X run types:check`; `pnpm build --filter @effected/X` with a zero-warning `dist/prod/issues.json` (never `node savvy.build.ts --target prod` directly — it skips `build:dev` and emits a truncated `issues.json` that looks clean); biome and tests green.

## Relationship to the per-package cycle

Scaffolding is step 2's mechanical half in the [migration-playbook.md](migration-playbook.md) cycle — the design doc is written first, then the package is scaffolded and built. This doc covers the package skeleton; the playbook covers the end-to-end cycle, and [package-inventory.md](package-inventory.md) records the packages that exist.
