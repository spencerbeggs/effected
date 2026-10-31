---
type: Module
title: pnpm-plugin-effected
description: "The kit's companion pnpm config dependency: it serves consumers one catalog, effected, holding the Effect family on one minor and every @effected/* package at its next release, and pins the Effect family graph-wide through derived overrides."
status: stable
kind: package
resource: ../../packages/pnpm-plugin-effected
tags:
  - release
  - architecture
sources:
  - id: savvy-build
    resource: ../../packages/pnpm-plugin-effected/savvy.build.ts
    title: "The declared effect and effected catalogs, overridesFromCatalogs and the authored overrides"
  - id: pnpmfile
    resource: ../../packages/pnpm-plugin-effected/src/pnpmfile.ts
    title: "The updateConfig wrapper that folds the declared catalogs into effected"
  - id: index
    resource: ../../packages/pnpm-plugin-effected/src/index.ts
    title: "The exported catalogs map, the same folded view"
  - id: catalog-test
    resource: ../../packages/pnpm-plugin-effected/__test__/catalog.test.ts
    title: "Membership, the minor-locked effect entries, the derived pins and the one-catalog fold"
generated:
  by: "okfit/claude-code"
  at: 2026-10-31T18:50:20Z
integrity:
  generated:
    body: 292215f7e8bc4ab2
---

# pnpm-plugin-effected

## Purpose

`@effected/pnpm-plugin-effected` is the kit's [companion](../glossary/companion-package.md) package: published and installable, but not a library. It is a pnpm **config dependency** (installed through `configDependencies`, not as a normal dependency) that centralizes the versions a consumer builds against. Installing it gives a workspace one catalog, `effected`, and a set of graph-wide `overrides`.

Nothing can depend on this package, since there is nothing to import and nothing to call, so tier does not apply. It publishes with the kit on the release gate like every other package. **Installing it is optional for the consumer**, who can pin Effect by hand, but shipping it is not optional for the release.

It replaces `@effected/pnpm-plugin-effect` and continues that package's version line; the old name gets no further release. Why one catalog, and why the rename came with it: [consumers see one catalog](../decisions/consumer-catalog-fold.md).

## What a consumer sees

One catalog, `effected`, used in `dependencies`, `devDependencies` and `peerDependencies` alike:

- `effect` and every `@effect/*` satellite, held to one Effect minor with a tilde range (`~4.<minor>.<patch>`), and `@effect/tsgo` on its own 0.x line with a caret, which on 0.x already holds the minor. Why a tilde: [the effect catalog holds one minor](../decisions/effect-catalog-minor-lock.md).
- Every publishable `@effected/*` package but this one, each at the version it will next publish, with a caret.

A consumer peer written as `catalog:effected` publishes the catalog's install range, patch included (`~4.<minor>.<patch>`, `^0.<minor>.<patch>`), not a floored one, because `pnpm pack` runs no `readPackage` hook.

`src/pnpmfile.ts` produces this view. It runs the generated `updateConfig`, then folds the declared `effect` catalog into `effected` and deletes `effect`, `effect:peers` and `effected:peers` from what pnpm sees. A consumer's own `effected` entries win.[^pnpmfile] `src/index.ts` exports the same folded view as `catalogs`.[^index] `__test__/catalog.test.ts` asserts that the built hook exposes exactly one catalog and that it carries both the Effect family and the kit.[^catalog-test]

## What it declares

`savvy.build.ts` still **declares** four catalogs through `rolldown-pnpm-config`'s `PnpmConfigPlugin`: `effect` and `effected`, each with a `:peers` twin.[^savvy-build] Each entry carries a `range`, a `peer` and a `strategy`, and the literal stays inline at the call site, because the `upgrade` CLI finds it by statically walking that argument. See [the effected catalog literal](../models/effected-catalog-literal.md) for its shape.

The declarations stay split because `overridesFromCatalogs` and the `upgrade` CLI both work per catalog. The Effect family is pinned graph-wide and the kit is not, and the directive's `exclude` takes exact names only, so one merged declaration would mean listing every kit package there.

- **`effect`**: `effect` and its satellites at `range: "~4.<minor>.<patch>"`, `peer: "~4.<minor>.0"`, `strategy: "lock-minor"`; `@effect/tsgo` at a `^0.<minor>.0` caret on the same strategy. `rolldown-pnpm-config` keeps each entry's operator when it derives the peer. `__test__/catalog.test.ts` requires the tilde on every 4.x entry, a peer floored to the minor, and one version across the family.[^catalog-test]
- **`effected`**: every publishable kit package but one, object form, `strategy: "lock-minor"`, `source: "workspace"`, holding next-release versions. `@effected/pnpm-plugin-effected` is deliberately absent: see [the plugin is never in its own catalog](../decisions/plugin-never-in-its-own-catalog.md). Membership is `publishConfig.access === "public"`, never `private === false`: see [the publishability-signal convention](../conventions/publishability-signal.md). What next-release versions imply: [the effected catalog holds next-release versions](../decisions/catalog-holds-next-release-versions.md). Keeping it current is automated: [the catalog:sync / catalog:check CLI](../interfaces/catalog-sync-cli.md).

The `effect` catalog carries no entries for packages Effect v4 absorbed into core (`@effect/platform`, `@effect/cluster`, `@effect/rpc`, `@effect/sql`, `@effect/workflow`, `@effect/experimental`). That absence is the removal signal: a lookup that finds nothing means the package no longer exists on the v4 line. The suffixed packages that still ship (`@effect/platform-node`, the `@effect/sql-*` drivers) stay. The retired v3 interop pair must not come back: [effect3 catalogs are retired](../decisions/effect3-catalogs-retired.md).

## How this repository consumes it

This repository does not install the plugin as a config dependency. `pnpm pnpm:export` writes the declared catalogs into the root `pnpm-workspace.yaml` directly, so the hook's fold never runs here. The workspace's manifests therefore keep `catalog:effect` (dev) and `catalog:effect:peers` (peers), and the kit's published `effect` peer is the floored `~4.<minor>.0`. The `effected` pair is exported too, but internal edges stay `workspace:*`.

## The derived family pins and the scoped platform-node-shared overrides

The plugin publishes a pnpm `overrides` block, which a consumer's install applies. A consumer's own value for the same selector wins.

Most of it is derived, not authored. The `overridesFromCatalogs: { catalog: "effect" }` directive makes `rolldown-pnpm-config` emit one `"<name>@^4.0.0": "<catalog version>"` entry for `effect` and every satellite, and a `"@effect/tsgo@^0.<minor>.0"` entry for tsgo on its own line, at build time. The pins move with the catalog literal and survive the registry `upgrade` CLI, which rewrites catalogs only. They reach transitive satellite requests that no catalog governs and hold the whole consumer graph on one `effect`. Each selector is scoped to `^4.0.0`, so a release candidate's own `effect` is untouched. Why this shape and what it costs: [the derived-overrides decision](../decisions/effect-overrides-derived-from-catalog.md).

The line scope also means the pins rewrite a published kit package built on an older 4.x minor onto the catalog version. When the new minor removed something that closure imports, it dies at import: that is how [the catalog crossed an Effect minor](../incidents/catalog-crossed-effect-minor.md).

The authored part holds two release-candidate entries, one per release candidate whose `@effect/platform-node` built tools still use:

- `@effect/platform-node@4.0.0-rc.117>@effect/platform-node-shared`: `4.0.0-rc.117`
- `@effect/platform-node@4.0.0-rc.118>@effect/platform-node-shared`: `4.0.0-rc.118`

Each pins the shared package to its parent's own version. A tool built on a release candidate takes `@effect/platform-node-shared` with a caret, and a fresh resolve paired it with a newer shared package built against a different `effect`; a tool on rc.117 crashed at startup. A selector names its parent's exact version, so an entry never touches a stable `4.x` install. Remove an entry once no tool consumers run is built on that candidate. This is the `overrides` bridge shape from [one resolved effect copy](../conventions/one-resolved-effect-copy.md), published by the plugin rather than written per workspace.

## The allowed-versions rules

`peerDependencyRules.allowedVersionsFromCatalogs` asks `rolldown-pnpm-config export` to derive version-qualified `"<satellite>@<pin>>effect"` rules into the root `pnpm-workspace.yaml`. It derives a rule only for an entry whose `range` is an exact version, and no `effect` entry is exact, so the exported `peerDependencyRules` is empty. The directive stays declared so that an exact entry would get its rule again. The table only ever suppressed reporting; it never changed resolution.

## Maintainer workflows

Three root scripts drive catalog maintenance and are **user-run only**. They rewrite this package's `savvy.build.ts` and the root `pnpm-workspace.yaml`, which moves resolution on the next install. `pnpm pnpm:up` runs the `upgrade` CLI interactively over `savvy.build.ts` and recomputes each peer floor, `pnpm pnpm:export` writes the catalogs and overrides into `pnpm-workspace.yaml`, and `pnpm pnpm:preview` shows the result without writing. An Effect minor goes through [advance the effect pin](../runbooks/advance-the-effect-pin.md), which edits the tilde ranges, re-pins `.repos/effect` in the same commit, and releases the kit with it.

The two `catalog:` scripts are a different class, and **agents may run them**: `pnpm catalog:sync` and `pnpm catalog:check` touch only `savvy.build.ts` and one fixed-name changeset, and CI runs them on every pull request to `main` and to `changeset-release/main`. See [the catalog:sync / catalog:check CLI](../interfaces/catalog-sync-cli.md). Under a tilde, the sync's `upgrade --yes` can move the Effect family to a new patch but never to a new minor.

## Relationship to the peer discipline

These catalogs are the mechanism behind the kit's peer-dependency discipline. The root `pnpm-workspace.yaml` sets exactly one resolver-relevant key, `autoInstallPeers: true`: no `dedupePeerDependents`, no `dedupeDirectDeps`, no `.npmrc`. This package declares **no** `effect` devDependency, and that absence is deliberate, because it ships and tests no `effect`-importing code. The devDependency it once carried steered the resolver to bind the bundler's `@effected/*` peers to the workspace's `effect`. Once the build toolchain carried its own `effect`, that steering inverted and leaked the workspace's copy into the toolchain's peers. Do not reintroduce it.

[^savvy-build]: `packages/pnpm-plugin-effected/savvy.build.ts`
[^pnpmfile]: `packages/pnpm-plugin-effected/src/pnpmfile.ts`
[^index]: `packages/pnpm-plugin-effected/src/index.ts`
[^catalog-test]: `packages/pnpm-plugin-effected/__test__/catalog.test.ts`
