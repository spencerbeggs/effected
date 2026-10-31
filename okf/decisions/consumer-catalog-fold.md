---
type: Decision
title: Consumers see one catalog, effected, folded by the plugin's hook from split declarations
description: "@effected/pnpm-plugin-effect is renamed @effected/pnpm-plugin-effected and serves consumers exactly one catalog, effected, holding the Effect family and the kit; savvy.build.ts still declares effect and effected separately with :peers twins because the override directive and the upgrade CLI work per catalog, and the plugin's updateConfig folds them."
status: stable
tags:
  - deps
  - release
  - dx
sources:
  - id: issue-1146
    resource: https://github.com/spencerbeggs/effected/issues/1146
    title: "Rename the catalog plugin and serve one catalog"
  - id: pnpmfile
    resource: ../../packages/pnpm-plugin-effected/src/pnpmfile.ts
    title: "The fold over the generated updateConfig"
  - id: index
    resource: ../../packages/pnpm-plugin-effected/src/index.ts
    title: "The exported catalogs, the same folded view"
  - id: catalog-test
    resource: ../../packages/pnpm-plugin-effected/__test__/catalog.test.ts
    title: "The consumer's catalog describe"
  - id: pack-probe
    resource: "Probe 2026-10-31: pnpm pack runs no readPackage hook, so a peer written as catalog:effected publishes the catalog's install range"
  - id: issue-1167
    resource: https://github.com/spencerbeggs/effected/issues/1167
    title: "The @effect/tsgo auto-patch, split out of 1146"
generated:
  by: "okfit/claude-code"
  at: 2026-10-31T18:50:20Z
integrity:
  generated:
    body: 9ab094a00a1d1273
  verified:
    by: human:spencer
    at: 2026-10-31T19:39:48Z
    content: a0ca18846a56ed84
verified:
  - by: human:spencer
    at: 2026-10-31T19:39:48Z
---

# Consumers see one catalog, effected, folded by the plugin's hook from split declarations

## Context

The plugin served four catalogs: `effect` and `effect:peers` for the Effect family, and `effected` and `effected:peers` for the kit. A consumer had to know which of the four a given manifest field wanted, and the split confused every consumer.[^issue-1146] The package's name, `pnpm-plugin-effect`, also described only half of what it carried.

The declarations could not simply merge. `overridesFromCatalogs` and the registry `upgrade` CLI both work per catalog. The Effect family is pinned graph-wide and the kit is not, and the directive's `exclude` takes exact names only, so a merged declaration would have to list every kit package as an exclusion.

## Decision

The package is renamed `@effected/pnpm-plugin-effected` (directory `packages/pnpm-plugin-effected`) and continues the old package's version line. The old name gets no further release.

`savvy.build.ts` still declares `effect` and `effected`, each with a `:peers` twin. The plugin's own `src/pnpmfile.ts` wraps the generated `updateConfig`: it folds `effect` into `effected`, lets a consumer's own `effected` entries win, and deletes `effect`, `effect:peers` and `effected:peers` from what pnpm sees.[^pnpmfile] `src/index.ts` exports the same folded view as `catalogs`.[^index] A consumer therefore sees exactly one catalog, `effected`, and writes `catalog:effected` in every dependency field. `__test__/catalog.test.ts` asserts the built hook exposes only `effected` and that it carries both halves.[^catalog-test]

This repository does not run the hook on itself. `pnpm pnpm:export` writes the declarations into the root `pnpm-workspace.yaml`, so the repository's manifests keep `catalog:effect` and `catalog:effect:peers`, and the kit's published `effect` peers keep their floored ranges.

## Alternatives rejected

- **Rewrite peer ranges in `readPackage`** so a consumer's `catalog:effected` peer would publish floored. `pnpm pack` runs no `readPackage` hook, so the rewrite would never reach a packed manifest.[^pack-probe] A consumer peer written as `catalog:effected` publishes the install range, patch included. A consumer that needs a floored peer writes that range by hand.
- **Merge the declarations into one catalog.** The derived family pins would then need every kit package named in `exclude`, and the `upgrade` CLI would treat both halves as one catalog.
- **Keep four catalogs and document them better.** The confusion was the cost being removed.

The `@effect/tsgo` auto-patch item of the same issue was split to its own issue, because `effect-tsgo patch` rewrites native binaries rather than applying a text diff.[^issue-1167]

## Consequences

- **A consumer's install fails loudly on a stale reference.** `catalog:effect`, `catalog:effect:peers` and `catalog:effected:peers` no longer exist for a consumer, so a manifest still naming one fails to resolve.
- **The new package needs its own npm trusted publisher** before its first release; the old package's configuration does not carry over.
- **The old package is deprecated on npm by the owner.**
- **Names elsewhere followed:** the sync script's `PLUGIN`, `CONFIG_PATH` and commit headline scope, the catalog-sync workflow, the root `pnpm:*` scripts, `design/packages.json` and `lib/configs/layers.json`.

The module: [pnpm-plugin-effected](../modules/pnpm-plugin-effected.md).

[^issue-1146]: <https://github.com/spencerbeggs/effected/issues/1146>
[^pnpmfile]: `packages/pnpm-plugin-effected/src/pnpmfile.ts`
[^index]: `packages/pnpm-plugin-effected/src/index.ts`
[^catalog-test]: `packages/pnpm-plugin-effected/__test__/catalog.test.ts`
[^pack-probe]: Probe, 2026-10-31.
[^issue-1167]: <https://github.com/spencerbeggs/effected/issues/1167>
