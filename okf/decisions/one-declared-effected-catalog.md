---
type: Decision
title: The plugin declares one catalog, effected, and pins only the Effect family by include pattern
description: "lib/build/pnpm-config.plugin.ts declares a single effected catalog (plus its effected:peers twin) holding the Effect family and the kit; overridesFromCatalogs selects the family with include patterns, so no @effected/* package is ever pinned graph-wide, and this repository's own manifests write catalog:effected like a consumer's."
status: stable
tags:
  - deps
  - release
  - dx
sources:
  - id: savvy-build
    resource: ../../packages/pnpm-plugin-effected/lib/build/pnpm-config.plugin.ts
    title: "The one effected catalog and the overridesFromCatalogs include patterns"
  - id: pnpmfile
    resource: ../../packages/pnpm-plugin-effected/src/pnpmfile.ts
    title: "The updateConfig wrapper that hides effected:peers"
  - id: catalog-test
    resource: ../../packages/pnpm-plugin-effected/__test__/catalog.test.ts
    title: "The kit and Effect-family describes, and the no-kit-pin assertion in the overrides describe"
  - id: sync-script
    resource: ../../lib/scripts/catalog-sync.ts
    title: "catalogMembers counts only @effected/* names"
  - id: upstream-include
    resource: https://github.com/spencerbeggs/rolldown-pnpm-config/issues/277
    title: "overridesFromCatalogs include patterns, released in rolldown-pnpm-config 2.3.0"
  - id: workspace-yaml
    resource: ../../pnpm-workspace.yaml
    title: "The root workspace's effected and effected:peers catalogs"
generated:
  by: "okfit/claude-code"
  at: 2026-11-09T00:05:23Z
verified:
  - by: human:spencer
    at: 2026-11-01T21:41:54Z
  - by: human:spencer
    at: 2026-11-08T18:25:54Z
  - by: human:spencer
    at: 2026-11-10T00:32:33Z
integrity:
  generated:
    body: eb38d94a96ebadbf
  verified:
    by: human:spencer
    at: 2026-11-10T00:32:33Z
    content: 4e63cac8cd25c5bb
---

# The plugin declares one catalog, effected, and pins only the Effect family by include pattern

**Amended.** The plugin now also declares a second catalog, `effected:build`, for the kit's build chain, and it is visible to consumers: see [the effected build catalog](effected-build-catalog.md). Everything below still holds for `effected`. "One catalog" now reads "one runtime catalog": the Effect family and the kit are never split, and the build chain is never folded into them.

## Context

[Consumers already saw one catalog](consumer-catalog-fold.md), but the plugin still declared two, `effect` and `effected`, each with a `:peers` twin, and its hook folded `effect` into `effected`. The split existed for one reason: `overridesFromCatalogs` could filter members only by an exact-name `exclude`, so a merged declaration would have had to list every kit package as an exclusion to keep the kit out of the graph-wide pins. `rolldown-pnpm-config` 2.3.0 added an `include` filter that takes glob patterns, which removed that reason.[^upstream-include]

## Decision

`lib/build/pnpm-config.plugin.ts` declares **one** catalog, `effected`: the Effect family (`effect`, every `@effect/*` package, `@effect/tsgo` included) followed by every publishable `@effected/*` package except the plugin itself. Its `peer` fields emit the `effected:peers` twin.[^savvy-build]

The derived family pins come from `overridesFromCatalogs: { catalog: "effected", include: ["effect", "@effect/*"] }`. The patterns use core `effect/Glob` semantics, so `*` does not cross the scope `/` and no `@effected/*` name matches either one. A member matched by both `include` and `exclude` is excluded, and an `include` entry that matches no member throws at build time rather than silently pinning nothing.[^upstream-include] `peerDependencyRules.allowedVersionsFromCatalogs.catalog` names `effected` too.

The hook no longer folds. `src/pnpmfile.ts` runs the generated `updateConfig` and deletes only `effected:peers` from what pnpm sees, so a consumer still sees exactly one catalog, `effected`.[^pnpmfile]

This repository uses the same names a consumer does. `pnpm pnpm:export` writes `effected` and `effected:peers` (and `effected:build` with its twin) into the root `pnpm-workspace.yaml`,[^workspace-yaml] and every workspace manifest writes `catalog:effected` for a dev or runtime dependency and `catalog:effected:peers` for a peer. The kit's published `effect` peer stays floored to the minor.

## The guarantee

The kit is never pinned graph-wide. A kit package added to the catalog gains no override, because it matches no `include` pattern. `__test__/catalog.test.ts` asserts that no derived override selector names an `@effected/*` package, and that the catalog holds nothing but the Effect family and the kit, so a widened filter or a stray entry fails the suite.[^catalog-test] The sync script's membership check counts only `@effected/*` names, because the family entries in the same catalog are not workspace membership.[^sync-script]

## Alternatives rejected

- **Keep the split declarations and the fold.** It worked, but it kept a second catalog name in this repository that no consumer could write, and a fold step whose only purpose was to undo the split.
- **Merge with an exhaustive `exclude`.** Every new kit package would have needed a second edit there, and a missed one would have pinned that package across every consumer graph.

## Consequences

- **A removed catalog has to be deleted from `pnpm-workspace.yaml` by hand.** `pnpm:export` keeps catalogs the plugin no longer declares; see [the export keeps removed catalogs gotcha](../gotchas/export-keeps-removed-catalogs.md).
- **`catalog:effect` and `catalog:effect:peers` no longer resolve in this repository**, as they already did not for a consumer.

The module: [pnpm-plugin-effected](../modules/pnpm-plugin-effected.md).

[^upstream-include]: <https://github.com/spencerbeggs/rolldown-pnpm-config/issues/277>
[^savvy-build]: `packages/pnpm-plugin-effected/lib/build/pnpm-config.plugin.ts`
[^pnpmfile]: `packages/pnpm-plugin-effected/src/pnpmfile.ts`
[^workspace-yaml]: `pnpm-workspace.yaml`
[^catalog-test]: `packages/pnpm-plugin-effected/__test__/catalog.test.ts`
[^sync-script]: `lib/scripts/catalog-sync.ts`
