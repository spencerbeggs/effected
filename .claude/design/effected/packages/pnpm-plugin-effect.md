---
status: current
module: effected
category: architecture
created: 2026-07-08
updated: 2026-08-21
last-synced: 2026-08-21
completeness: 90
related:
  - ../architecture.md
  - ../catalog-sync.md
  - ../effect-standards.md
  - ../package-inventory.md
  - ../releases.md
---

# @effected/pnpm-plugin-effect design

## Overview

`@effected/pnpm-plugin-effect` is the kit's [companion](../effect-standards.md#companion-packages-published-but-not-a-library) package — published and installable, but not a library. It is a pnpm **config dependency** (installed with `pnpm add --config`, not as a normal dependency) that centralizes Effect-ecosystem versioning by publishing pnpm [catalogs](https://pnpm.io/catalogs). It is the single source of truth for what "the current Effect version" means: every `@effected/*` package references `catalog:effect` / `catalog:effect:peers`, and once published, so can any external workspace that installs it. Since 2026-08-21 it carries the kit's own version surface too, so one installed config dependency pins both halves of what a consumer builds against.

The catalogs consumers pin against:

- **`effect`** — every `effect` / `@effect/*` package on the v4 line, pinned to the current prerelease.
- **`effect:peers`** — the same package set as the advertised peer range.
- **`effected`** — the kit's own packages, at the version each will next publish; see [the effected catalog](#the-effected-catalog-the-kits-own-version-surface).
- **`effected:peers`** — the same set as the advertised peer range.

These four are the whole set. The Effect v3 interop catalogs and the camelCase aliases are gone; see [the retired effect3 interop catalogs](#the-retired-effect3-interop-catalogs).

## Classification: companion

Tier answers "what does depending on this cost you?" and nothing can depend on this package — there is nothing to import and nothing to call. It carries **no tier**, and `companion` is a category rather than a fourth tier: the three-tier taxonomy classifies libraries, and this is not one. What it ships is configuration, not code.

It is a real npm-targeted package that **publishes with the kit, on the release gate like every other package** ([releases.md](../releases.md#versioning)). Being a companion makes it structurally free to release on its own schedule, but the release is coordinated by design so consumers get one internally consistent graph. Do not infer release intent from surface signals: every source manifest in this repo is `"private": true`, and the bundler's `publishConfig` transform emits the publishable manifest at build time ([package-setup.md](../package-setup.md)).

Its value was largest under Effect v3, where computing peer floors by hand was genuinely hard; v4 makes that easier, so **installing it is optional for the consumer** — but it is a supported, shipped option, not an internal tool that happens to be publishable.

## How it generates the catalogs

The catalog strategy is declared in [`savvy.build.ts`](../../../../packages/pnpm-plugin-effect/savvy.build.ts) via `rolldown-pnpm-config`'s `PnpmConfigPlugin`. Each package entry carries a `range` (the pinned version), a `peer` (the input to the floor computation) and a `strategy`. Memberships, versions and strategies all live in that file — read it rather than a transcription that rots on every catalog bump. Two facts are load-bearing:

- **The `effect` (v4) catalog pins exact, never a caret.** A caret on a prerelease floats across the release line and desynchronizes the installed `effect` from the `.repos/effect` submodule that is authoritative on what v4 exports.
- **The `effect` catalog uses the `lock` strategy.** Every consumer resolves to the same pinned version on install, so the whole graph holds one Effect v4 prerelease rather than each consumer re-deriving a range. Under `lock` the `peer` inputs equal the pinned versions, which is why `effect:peers` holds the same exact pin rather than a caret floor.

`src/index.ts` and `src/pnpmfile.ts` are one-line re-exports over `rolldown-pnpm-config` virtual modules; all real configuration is in `savvy.build.ts`. The build sets `bundleNodeModules: true` and uses `looseFiles` to ship the pnpmfile (`pnpmfile.mjs` / `pnpmfile.cjs`) that pnpm loads as the config dependency's hook.

### Absence means absorbed

The v4 `effect` catalog deliberately carries **no** entries for the packages Effect v4 absorbed into core: `@effect/platform`, `@effect/cluster`, `@effect/rpc`, `@effect/sql`, `@effect/workflow` and `@effect/experimental`. That absence **is** the removal signal — a consumer or migration agent looking one of these up and finding nothing should read it as "this package no longer exists on the v4 line; its functionality lives in `effect` core", not as an oversight. Do not confuse them with the suffixed packages that still ship on v4 and are in the catalog (`@effect/platform-node`, the `@effect/sql-*` drivers); only the bare absorbed names are gone.

## The `effected` catalog: the kit's own version surface

The `effected` / `effected:peers` catalogs list **every publishable kit package but one**, in object form with a `range`, a `peer`, `strategy: "lock-minor"` and `source: "workspace"`. They exist for consumers, not for this workspace: internal edges stay `workspace:*`, and the catalogs are not exported into the root `pnpm-workspace.yaml` the way the Effect ones are.

Four properties are load-bearing.

- **`@effected/pnpm-plugin-effect` is deliberately absent from its own catalog, and must stay absent.** It is the package the catalog ships inside: catalogue it and every rewrite bumps the plugin, which invalidates the catalog, which writes another changeset — a release loop with no termination condition. The omission *is* the termination condition. Two tests in [`__test__/catalog.test.ts`](../../../../packages/pnpm-plugin-effect/__test__/catalog.test.ts) pin it.
- **Publishability is `publishConfig.access === "public"`, never `private === false`.** All thirty source manifests here are `private: true` and the bundler's `publishConfig` transform emits the publishable one at build time ([package-setup.md](../package-setup.md)). Any membership check written against `private` classifies the entire kit as unpublishable and silently produces an empty catalog.
- **The literal must stay inline at the `PnpmConfigPlugin(...)` call site.** `rolldown-pnpm-config`'s `upgrade` CLI finds it by statically walking that call argument for `.catalogs.<name>.packages`; hoisting it into an exported `const` makes it invisible to the rewriter. `savvy.build.ts` is a top-level `await build({...})`, so a test cannot import it either — the test reads the source the same way the CLI does, which is why that parsing exists at all.
- **Entries hold next-release versions.** See [catalog-sync.md](../catalog-sync.md#catalog-entries-hold-next-release-versions) for what follows from that, including why a first sync flooring a peer patch is correct rather than drift.

Keeping the catalog current is automated; the machinery, and the release gate that is not yet wired, are in [catalog-sync.md](../catalog-sync.md).

## The retired effect3 interop catalogs

The plugin once shipped `effect3` / `effect3:peers` catalogs tracking the latest Effect v3 releases, so a package could be tested against both majors in one monorepo; they used an `interop` strategy that downleveled peers to the widest safe floor, and camelCase aliases (`effectPeers`, `effect3Peers`) shadowed the colon-form names for compatibility. All of it was removed on the `rc.109` advance: no consumer referenced the v3 catalogs or the aliases any longer, and the rolldown-pnpm-config `0.6.x` generator emits only colon-form catalog names. This retired them ahead of the plugin-`1.0.0` graduation originally planned to do it. Do not reintroduce them — with no Effect v3 anywhere in the workspace lockfile, an interop catalog would be dead configuration.

## The generated allowed-versions table

Every catalog advance strands previously-published artifacts: under `lock`, a registry package peers on the exact version it was built against, so the moment the workspace installs the next pin that peer goes unmet and `pnpm peers check` gains a warning. The structural fix is a `peerDependencyRules.allowedVersions` table in the root `pnpm-workspace.yaml` declaring the lock catalog's current pin an acceptable resolution — retiring the warning class rather than documenting each occupant.

**The table is derived, never hand-written.** `PnpmConfigPlugin`'s `peerDependencyRules.allowedVersionsFromCatalogs` option names the source catalog and the peer each rule targets; `rolldown-pnpm-config export` emits one rule per lock-catalog package into the workspace file. Earlier iterations of this mechanism were a hand-authored table and then a standalone generator script with sentinel comments and a drift tripwire; both are gone, and neither should be reintroduced — the declarative option is the supported form.

Two properties are load-bearing:

- **Rules are version-qualified parent selectors** (`"<satellite>@<its pin>>effect"`), never blanket and never name-only. pnpm applies a qualified rule only when the actual parent instance's version satisfies the qualifier, so any other instance of the same satellite name — a toolchain-carried older prerelease, or historically the v3 line through the retired interop catalog — still warns on a genuinely unmet peer.
- **The scope is effect's own satellites, not the kit's `@effected/*` members.** The kit controls its own artifacts and the republish cycle repairs their stranding properly; covering them would mask a real defect.

The table suppresses reporting only — it does not change resolution, so `autoInstallPeers` may still materialize an older `effect` instance for a stranded artifact's subgraph. That was accepted until the `rc.109` advance proved a second copy is not always inert: the toolchain's subgraph mixed two `effect` copies into one Schema decode pipeline and crashed every build, and the temporary overrides bridge in `pnpm-workspace.yaml` now collapses those trees to one copy ([architecture.md](../architecture.md#the-temporary-overrides-bridge)). What the table buys is the stronger invariant the dependency discipline states: any peer warning outside the toolchain graph is a genuine closure defect to fix upstream, not something to tolerate.

## Maintainer workflows

Three root scripts drive catalog maintenance. They regenerate the plugin's definitions and mutate the lockfile and root `pnpm-workspace.yaml`, so they are **user-run commands; agents must not invoke them** — surface the right command and let the user run it.

- **`pnpm pnpm:up`** — pins each `effect` / `@effect/*` package to its latest v4 release and recomputes the peer floor. This is how the catalogs advance as new releases land.
- **`pnpm pnpm:export`** — writes the generated catalogs and the allowed-versions table into the root `pnpm-workspace.yaml`, and surfaces any drift between the plugin's definitions and what the workspace pins.
- **`pnpm pnpm:preview`** — previews the generated output without writing.

Advancing the beta is `pnpm pnpm:up` then `pnpm pnpm:export`, and the submodule is re-pinned in the same commit ([architecture.md](../architecture.md#re-pinning-when-the-effect-catalog-bumps)).

The two `catalog:` scripts are a different class and are **not** in the user-run-only set: `pnpm catalog:sync` and `pnpm catalog:check` touch only `savvy.build.ts` and one fixed-name changeset, never the lockfile or `pnpm-workspace.yaml`, and CI runs the first of them on every push to `main` ([catalog-sync.md](../catalog-sync.md)).

## Consumer usage

Installing the config dependency gives a workspace the catalogs. The two consumer patterns:

- **Applications** reference the pinned versions directly in `dependencies` (`"effect": "catalog:effect"`), so the app always runs the current Effect.
- **Libraries** pin the dev version and declare the calculated floor as the peer range: `catalog:effect` in `devDependencies`, `catalog:effect:peers` in `peerDependencies`.

The install steps and the two patterns are the package [README](../../../../packages/pnpm-plugin-effect/README.md); the maintainer workflows above are intentionally kept out of it.

## Relationship to the workspace peer discipline

These catalogs are the mechanism behind the [peer-dependency discipline](../effect-standards.md#peer-dependency-discipline) in the standards. Root `pnpm-workspace.yaml` sets exactly one resolver-relevant key, `autoInstallPeers: true` — no `dedupePeerDependents`, no `dedupeDirectDeps`, no `.npmrc`. Do not reintroduce any of them. The v3/v4 peer-resolution bug that once required pnpm-resolver workarounds is fixed upstream.

**The direct `effect` (`catalog:effect`) devDependency here is load-bearing — do not remove it as unused** (347ca229). With no `effect` of its own, this package let pnpm bind the bundler's `@effected/*` peers to the v3 `effect` that `rolldown-pnpm-config` carried at the time, loading v4 code against v3 at build time. The hazard class outlives that v3 instance — the toolchain still carries its own older `effect` for the resolver to reach for — so the devDependency stays: it exists purely to give the resolver the right version to bind, and the companion still ships no `effect`-importing code.
