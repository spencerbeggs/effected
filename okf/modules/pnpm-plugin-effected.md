---
type: Module
title: pnpm-plugin-effected
description: "The kit's companion pnpm config dependency: it serves consumers two catalogs, effected (the Effect family on one minor and every @effected/* package at its next release) and effected:build (the kit's build chain and toolchain), and pins the Effect family graph-wide through derived overrides."
status: stable
kind: package
resource: ../../packages/pnpm-plugin-effected
tags:
  - release
  - architecture
sources:
  - id: savvy-build
    resource: ../../packages/pnpm-plugin-effected/lib/build/pnpm-config.plugin.ts
    title: "The one declared effected catalog, overridesFromCatalogs and the authored overrides"
  - id: pnpmfile
    resource: ../../packages/pnpm-plugin-effected/src/pnpmfile.ts
    title: "The updateConfig wrapper that hides effected:peers and effected:build:peers"
  - id: index
    resource: ../../packages/pnpm-plugin-effected/src/index.ts
    title: "The exported catalogs map: effected and effected:build"
  - id: catalog-test
    resource: ../../packages/pnpm-plugin-effected/__test__/catalog.test.ts
    title: "Membership, the minor-locked Effect-family entries, the derived pins and the one consumer catalog"
generated:
  by: "okfit/claude-code"
  at: 2026-11-09T00:05:23Z
integrity:
  generated:
    body: c92073fe143150d0
---

# pnpm-plugin-effected

## Purpose

`@effected/pnpm-plugin-effected` is the kit's [companion](../glossary/companion-package.md) package: published and installable, but not a library. It is a pnpm **config dependency** (installed through `configDependencies`, not as a normal dependency) that centralizes the versions a consumer builds against. Installing it gives a workspace two catalogs, `effected` for what code runs on and `effected:build` for what it builds with, and a set of graph-wide `overrides`.

Nothing can depend on this package, since there is nothing to import and nothing to call, so tier does not apply. It publishes with the kit on the release gate like every other package. **Installing it is optional for the consumer**, who can pin Effect by hand, but shipping it is not optional for the release.

It replaces `@effected/pnpm-plugin-effect` and continues that package's version line; the old name gets no further release. Why one catalog, and why the rename came with it: [consumers see one catalog](../decisions/consumer-catalog-fold.md). Why it is also declared as one: [the one declared effected catalog](../decisions/one-declared-effected-catalog.md). Why the build chain is a second, visible catalog: [the effected build catalog](../decisions/effected-build-catalog.md).

## What a consumer sees

Two catalogs. The runtime one, `effected`, is used in `dependencies`, `devDependencies` and `peerDependencies` alike:

- `effect` and every `@effect/*` satellite, held to one Effect minor with a tilde range (`~4.<minor>.<patch>`), and `@effect/tsgo` on its own 0.x line with a caret, which on 0.x already holds the minor. Why a tilde: [the effect catalog holds one minor](../decisions/effect-catalog-minor-lock.md).
- Every publishable `@effected/*` package but this one, each at the version it will next publish, with a caret.

The second, `effected:build`, holds the build chain `effected package build` runs (`tsdown`, `@tsdown/exe`, `rolldown`, `rolldown-plugin-dts`, `@microsoft/api-extractor`, `@microsoft/api-extractor-model`, `@microsoft/tsdoc`, `@microsoft/tsdoc-config`) and the toolchain a package builds against (`typescript`, `@types/node`, `tsx`, `react`, `react-dom`, `@types/react`, `@types/react-dom`, `@rsbuild/core`), at the ranges silk's `build` catalog carried when the kit took it over. See [the build catalog](#the-build-catalog).

A consumer peer written as `catalog:effected` publishes the catalog's install range, patch included (`~4.<minor>.<patch>`, `^0.<minor>.<patch>`), not a floored one, because `pnpm pack` runs no `readPackage` hook.

`src/pnpmfile.ts` produces this view. It runs the generated `updateConfig`, whose merge lets a consumer's own `effected` entries win, then deletes `effected:peers` and `effected:build:peers` from what pnpm sees.[^pnpmfile] `src/index.ts` exports `effected` and `effected:build` as `catalogs`.[^index] `__test__/catalog.test.ts` asserts that the built hook exposes exactly those two catalogs, that `effected` carries both the Effect family and the kit, and that `effected:build` carries the build chain.[^catalog-test]

## What it declares

`lib/build/pnpm-config.plugin.ts` **declares** two catalogs through `rolldown-pnpm-config`'s `PnpmConfigPlugin`, `effected` and `effected:build`, and their entries' `peer` fields emit `effected:peers` and `effected:build:peers` twins.[^savvy-build] This section is about `effected`; the build chain has [its own section](#the-build-catalog). Each entry carries a `range`, a `peer` and a `strategy`, and the literal stays inline at the call site, because the `upgrade` CLI finds it by statically walking that argument. See [the effected catalog literal](../models/effected-catalog-literal.md) for its shape.

The catalog holds two halves, and the test reads each one by name prefix.[^catalog-test] The Effect family is pinned graph-wide and the kit is not; the override directive's `include` patterns draw that line inside the one catalog (see [the derived family pins](#the-derived-family-pins-and-the-scoped-platform-node-shared-overrides)).

- **The Effect family**: `effect` and its satellites at `range: "~4.<minor>.<patch>"`, `peer: "~4.<minor>.0"`, `strategy: "lock-minor"`; `@effect/tsgo` at a `^0.<minor>.0` caret on the same strategy. `rolldown-pnpm-config` keeps each entry's operator when it derives the peer. `__test__/catalog.test.ts` requires the tilde on every 4.x entry, a peer floored to the minor, and one version across the family.[^catalog-test]
- **The kit**: every publishable kit package but one, object form, `strategy: "lock-minor"`, `source: "workspace"`, holding next-release versions. `@effected/pnpm-plugin-effected` is deliberately absent: see [the plugin is never in its own catalog](../decisions/plugin-never-in-its-own-catalog.md). Membership is `publishConfig.access === "public"`, never `private === false`: see [the publishability-signal convention](../conventions/publishability-signal.md). What next-release versions imply: [the effected catalog holds next-release versions](../decisions/catalog-holds-next-release-versions.md). Keeping it current is automated: [the catalog:sync / catalog:check CLI](../interfaces/catalog-sync-cli.md).

The catalog carries no entries for packages Effect v4 absorbed into core (`@effect/platform`, `@effect/cluster`, `@effect/rpc`, `@effect/sql`, `@effect/workflow`, `@effect/experimental`). That absence is the removal signal: a lookup that finds nothing means the package no longer exists on the v4 line. The suffixed packages that still ship (`@effect/platform-node`, the `@effect/sql-*` drivers) stay. The retired v3 interop pair must not come back: [effect3 catalogs are retired](../decisions/effect3-catalogs-retired.md).

## The build catalog

`effected:build` follows the same entry shape (`range`, `peer`, `strategy`), with no `source`: every member resolves from the registry. Three rules hold it apart from `effected`:

- **It derives no override.** `overridesFromCatalogs` names only `effected`. The test asserts no derived selector targets a build-chain package.[^catalog-test]
- **The catalog sync never moves it.** `lib/scripts/catalog-sync.ts` passes `--catalog effected`, and because the upgrade CLI honours that flag only interactively, it also restores the `effected:build` block after `--yes` and scopes `--check`'s drift to `effected`. Build-chain entries move only through `pnpm:up`. See [the catalog:sync / catalog:check CLI](../interfaces/catalog-sync-cli.md).
- **It names nothing from the kit or the Effect family**, which belong to `effected`.

`rolldown-plugin-dts` sits at `^0.30.0`, the line tsdown asks for itself; the kit adds no `tsdown>rolldown-plugin-dts` override. The plugin also declares one hand-written `peerDependencyRules.allowedVersions` rule, `tsdown>typescript`, because tsdown's `typescript` peer admits no 7.1 prerelease and the catalog holds `typescript` at one. Its value is silk's for the same key, so the two plugins never disagree on it. Why: [the effected build catalog](../decisions/effected-build-catalog.md).

## The carrier hoist

The plugin sets `publicHoistPattern: ["@effected/plugin"]`, so the `effected` and `effected-mcp` bins of the [carrier](plugin.md) reach the workspace root. A packed-install e2e showed it matters only when a leaf workspace package declares the carrier; a root devDependency's bin already resolves. The catalog lists the tool's packages with the rest of the kit, and the recommended consumer install is `"@effected/plugin": "catalog:effected"` as a root devDependency.

## How this repository consumes it

This repository does not install the plugin as a config dependency. `pnpm pnpm:export` writes all four declared catalogs (`effected`, `effected:peers`, `effected:build`, `effected:build:peers`) into the root `pnpm-workspace.yaml` directly, so the hook never runs here and the `:peers` twins stay visible. The workspace's manifests write the same catalog names a consumer does: `catalog:effected` for a dev or runtime dependency and `catalog:effected:peers` for a peer, and `catalog:effected:build` / `catalog:effected:build:peers` for the build chain, so the kit's published `effect` peer is the floored `~4.<minor>.0`. Internal `@effected/*` edges stay `workspace:*` or `workspace:^`, never the catalog. The export never deletes a catalog the plugin stopped declaring: [the export keeps removed catalogs](../gotchas/export-keeps-removed-catalogs.md).

## The derived family pins and the scoped platform-node-shared overrides

The plugin publishes a pnpm `overrides` block, which a consumer's install applies. A consumer's own value for the same selector wins.

Most of it is derived, not authored. The `overridesFromCatalogs: { catalog: "effected", include: ["effect", "@effect/*"] }` directive makes `rolldown-pnpm-config` emit one `"<name>@^4.0.0": "<catalog version>"` entry for `effect` and every satellite, and a `"@effect/tsgo@^0.<minor>.0"` entry for tsgo on its own line, at build time. The `include` patterns select the family by glob; `*` does not cross the scope `/`, so no `@effected/*` entry matches and the kit is never pinned, which `__test__/catalog.test.ts` asserts.[^catalog-test] The pins move with the catalog literal and survive the registry `upgrade` CLI, which rewrites catalogs only. They reach transitive satellite requests that no catalog governs and hold the whole consumer graph on one `effect`. Each selector is scoped to `^4.0.0`, so a release candidate's own `effect` is untouched. Why this shape and what it costs: [the derived-overrides decision](../decisions/effect-overrides-derived-from-catalog.md).

The line scope also means the pins rewrite a published kit package built on an older 4.x minor onto the catalog version. When the new minor removed something that closure imports, it dies at import: that is how [the catalog crossed an Effect minor](../incidents/catalog-crossed-effect-minor.md).

The authored part holds two release-candidate entries, one per release candidate whose `@effect/platform-node` built tools still use:

- `@effect/platform-node@4.0.0-rc.117>@effect/platform-node-shared`: `4.0.0-rc.117`
- `@effect/platform-node@4.0.0-rc.118>@effect/platform-node-shared`: `4.0.0-rc.118`

Each pins the shared package to its parent's own version. A tool built on a release candidate takes `@effect/platform-node-shared` with a caret, and a fresh resolve paired it with a newer shared package built against a different `effect`; a tool on rc.117 crashed at startup. A selector names its parent's exact version, so an entry never touches a stable `4.x` install. Remove an entry once no tool consumers run is built on that candidate. This is the `overrides` bridge shape from [one resolved effect copy](../conventions/one-resolved-effect-copy.md), published by the plugin rather than written per workspace.

## The allowed-versions rules

`peerDependencyRules.allowedVersionsFromCatalogs` asks `rolldown-pnpm-config export` to derive version-qualified `"<satellite>@<pin>>effect"` rules into the root `pnpm-workspace.yaml`. It derives a rule only for an entry whose `range` is an exact version, and no catalog entry is exact, so the exported `peerDependencyRules` is empty. It names the `effected` catalog. The directive stays declared so that an exact entry would get its rule again. The table only ever suppressed reporting; it never changed resolution.

## Maintainer workflows

Three root scripts drive catalog maintenance and are **user-run only**. They rewrite this package's `lib/build/pnpm-config.plugin.ts` and the root `pnpm-workspace.yaml`, which moves resolution on the next install. `pnpm pnpm:up` runs the `upgrade` CLI interactively over `lib/build/pnpm-config.plugin.ts` and recomputes each peer floor, `pnpm pnpm:export` writes the catalogs and overrides into `pnpm-workspace.yaml`, and `pnpm pnpm:preview` shows the result without writing. An Effect minor goes through [advance the effect pin](../runbooks/advance-the-effect-pin.md), which edits the tilde ranges, re-pins `.repos/effect` in the same commit, and releases the kit with it.

The two `catalog:` scripts are a different class, and **agents may run them**: `pnpm catalog:sync` and `pnpm catalog:check` touch only `lib/build/pnpm-config.plugin.ts` and one fixed-name changeset, and CI runs them on every pull request to `main` and to `changeset-release/main`. See [the catalog:sync / catalog:check CLI](../interfaces/catalog-sync-cli.md). Under a tilde, the sync's `upgrade --yes` can move the Effect family to a new patch but never to a new minor. It never moves `effected:build`.

## Relationship to the peer discipline

These catalogs are the mechanism behind the kit's peer-dependency discipline. The root `pnpm-workspace.yaml` sets exactly one resolver-relevant key, `autoInstallPeers: true`: no `dedupePeerDependents`, no `dedupeDirectDeps`, no `.npmrc`. This package declares **no** `effect` devDependency, and that absence is deliberate, because it ships and tests no `effect`-importing code. The devDependency it once carried steered the resolver to bind the bundler's `@effected/*` peers to the workspace's `effect`. Once the build toolchain carried its own `effect`, that steering inverted and leaked the workspace's copy into the toolchain's peers. Do not reintroduce it.

[^savvy-build]: `packages/pnpm-plugin-effected/lib/build/pnpm-config.plugin.ts`
[^pnpmfile]: `packages/pnpm-plugin-effected/src/pnpmfile.ts`
[^index]: `packages/pnpm-plugin-effected/src/index.ts`
[^catalog-test]: `packages/pnpm-plugin-effected/__test__/catalog.test.ts`
