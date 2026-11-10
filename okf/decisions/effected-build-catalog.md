---
type: Decision
title: The plugin declares a second consumer-visible catalog, effected:build, for the kit's build chain
description: "lib/build/pnpm-config.plugin.ts declares effected:build beside effected: the build chain effected package build runs (tsdown, @tsdown/exe, rolldown, rolldown-plugin-dts, API Extractor and TSDoc) and the toolchain a package builds against (typescript, @types/node, tsx, React and its types, @rsbuild/core). A consumer sees it as catalog:effected:build, with catalog:effected:build:peers for peers; it derives no override, and the catalog sync never moves it. Amends one-declared-effected-catalog and consumer-catalog-fold, whose runtime-catalog rules stand."
status: draft
tags:
  - deps
  - release
  - dx
sources:
  - id: issue-1277
    resource: https://github.com/spencerbeggs/effected/issues/1277
    title: "Move the build chain out of silk's build catalog into an effected build catalog"
  - id: savvy-build
    resource: ../../packages/pnpm-plugin-effected/lib/build/pnpm-config.plugin.ts
    title: "The effected:build catalog and the tsdown>typescript allowed-versions rule"
  - id: pnpmfile
    resource: ../../packages/pnpm-plugin-effected/src/pnpmfile.ts
    title: "The generated updateConfig, re-exported; it serves every catalog, the :peers twins included"
  - id: catalog-test
    resource: ../../packages/pnpm-plugin-effected/__test__/catalog.test.ts
    title: "The effected:build describe and the two-catalog consumer view"
  - id: sync-script
    resource: ../../lib/scripts/catalog-sync.ts
    title: "SYNC_CATALOG and checkVerdict"
  - id: silk-build
    resource: "@savvy-web/pnpm-plugin-silk 0.52.0 pnpmfile.mjs, the build catalog and the tsdown>rolldown-plugin-dts override"
generated:
  by: "okfit/claude-code"
  at: 2026-11-10T04:40:05Z
integrity:
  generated:
    body: 131af9b8d963f5f1
---

# The plugin declares a second consumer-visible catalog, effected:build, for the kit's build chain

## Context

Since #1249 the kit owns its build: `effected package build` runs tsdown, rolldown, the declaration pass and API Extractor through `@effected/bundler`. The versions of that chain still came from `@savvy-web/pnpm-plugin-silk`'s `build` catalog, so a repository moving off the savvy bundlers onto the kit's still took its build chain from silk. The chain also split in two there: silk injects a graph-wide `tsdown>rolldown-plugin-dts: ^0.29.0` override while `tsdown` 0.23.7 asks for `^0.30.0`, so the lockfile resolved one copy for tsdown's declaration pass and another for the bundler's own dependency, which no consumer could see without reading silk's pnpmfile.[^issue-1277] [^silk-build]

## Decision

`lib/build/pnpm-config.plugin.ts` declares a second catalog, `effected:build`, after `effected`.[^savvy-build] It holds:

- the chain the bundler runs: `tsdown`, `@tsdown/exe`, `rolldown`, `rolldown-plugin-dts`, `@microsoft/api-extractor`, `@microsoft/api-extractor-model`, `@microsoft/tsdoc`, `@microsoft/tsdoc-config`;
- the toolchain a package builds and typechecks against: `typescript`, `@types/node`, `tsx`, `react`, `react-dom`, `@types/react`, `@types/react-dom`, `@rsbuild/core`.

Each range, peer and strategy was copied from silk's `build` catalog as installed, and the lockfile's resolutions were the sanity check. `rolldown-plugin-dts` is new: it was not in silk's catalog, and it sits at `^0.30.0`, the line tsdown itself asks for. `@tsdown/css` and `@types/bun` stay with silk: the kit reads neither.

**It is visible to consumers, with its peers twin.** The hook serves `effected:build` and `effected:build:peers` beside `effected` and `effected:peers`, and a consumer's own entries in any of them win.[^pnpmfile] A repository that builds with the kit writes `catalog:effected:build` for those packages in `devDependencies`, and `catalog:effected:build:peers` for a peer such as `typescript`. `src/index.ts` exports all four catalogs. The hook hid both twins until the Effect family was served exactly; [the module](../modules/pnpm-plugin-effected.md) records why that changed.

**It derives no override.** `overridesFromCatalogs` still names only `effected`, with the family `include` patterns. A build-chain range is a catalog range, not a graph-wide pin, and the test asserts that no derived override targets a build-chain package.[^catalog-test] The kit adds no `tsdown>rolldown-plugin-dts` override of its own: tsdown's own range already holds the declaration pass on `^0.30.0`, and an override is what split it.

**It carries one peer rule.** `peerDependencyRules.allowedVersions` admits a TypeScript 7.1 prerelease under `tsdown`, whose `typescript` peer (`^5.0.0 || ^6.0.0 || ^7.0.0`) admits none. The value is silk's for the same key, so a consumer running both plugins merges two equal rules.

**The settings that came with the chain.** Silk's plugin also held the pnpm settings that let the chain install, and a repository building with the kit on a silk release that drops them, or on no silk, would lose them. So the plugin carries every setting whose reason is the chain or the kit, copied at silk's value for the same key.[^savvy-build] The test is the lockfile's transitive closure of the `effected:build` members, not the catalog's name list.

- **`minimumReleaseAgeExclude`** gains:
  - `@effected/*`, so a kit release installs the day it ships;
  - three patterns for the chain's lockstep satellites: `@rolldown/*` (rolldown's platform bindings), `@oxc-project/*` (`@oxc-project/types`, which rolldown pins exactly) and `@typescript/*` (TypeScript 7's native platform packages);
  - every package the `effected:build` catalog names (`tsdown`, `rolldown`, `rolldown-plugin-dts`, `@tsdown/*`, `@rsbuild/*`, `typescript`, `tsx`, `@types/node`, React and its types).

  The catalog pins those and moves them only through a deliberate `pnpm:up`. A quarantine on that move only blocks the upgrade it was chosen for, as it held rolldown 1.3.1. That is the owner's ruling.
- **`publicHoistPattern`** hoists `typescript`, `tsx`, `@types/node`, `@types/react` and `@types/react-dom` beside the carrier. A consumer then gets the toolchain installed and reachable from every workspace package through the plugin, as silk provided it, without declaring each one, and dropping silk loses none of them. The kit's own build doesn't need the hoist: the bundler resolves `typescript` from its peer link. The consumer-side reach is the reason, and it is the owner's ruling.
- **`allowBuilds: { esbuild: true }`**, because tsx's esbuild runs a postinstall and `strictDepBuilds` fails an install on an unlisted one. It is the only install script in the closure. `core-js` is only an optional peer of `@rsbuild/core`, so it stays with silk.
- **`peerDependencyRules.allowedVersions`** keeps only `tsdown>typescript`. The other seven silk rules admit the prerelease under twoslash, vue, commitlint and cosmiconfig, which are silk's docs and lint packages.

Lists merge by union and maps let the child win, warning only when the values differ, so two plugins declaring the same entry produce one entry and no warning. The test pins that against a silk-shaped config, and pins a divergent value's warning as its control.[^catalog-test]

Some settings stay with silk on purpose:

- **The quarantine value and the security flags.** `minimumReleaseAge`, `strictDepBuilds` and `blockExoticSubdeps` are repository policy, not the chain.
- **`confirmModulesPurge`, and every entry for lint, docs, test or silk's own packages.**
- **`allowedDeprecatedVersions`.** No package it names is in the closure.
- **`ignoreMissing`.** The kit's bundler and tool packages peer `typescript` and `@types/node` as required, so silencing a missing one would hide a build that cannot run.

**The catalog sync never moves it.** The sync manages next-release versions of the kit; a build-chain move is a deliberate upgrade. `catalog-sync.ts` passes `--catalog effected`, to both `--yes` and `--check`, and the upgrade CLI scopes every mode to it from rolldown-pnpm-config 2.4.5, so neither writes nor reports an `effected:build` entry. An undeclared name exits 1 with an `error.kind` of `catalog`, which `checkVerdict` keeps red.[^sync-script] Build-chain entries move through the user-run `pnpm:up`.

This repository consumes it the way it consumes `effected`: `pnpm:export` writes `effected:build` and `effected:build:peers` into the root `pnpm-workspace.yaml`, and the workspace manifests write `catalog:effected:build` and `catalog:effected:build:peers`. The silk `lint`, `test`, `silk` and `docs` catalogs, the silk presets and the silk configDependency stay where they are.

## Alternatives rejected

- **Fold the chain into `effected`.** The test that holds `effected` to the Effect family and the kit would lose its meaning, and the sync's membership and ripple logic would have to learn which entries are not the kit.
- **Leave the chain on silk.** Downstream repositories deprecating the savvy bundlers would have kept a dependency on silk's catalog for the one thing the kit now owns, and the declaration-pass split would stay invisible.
- **Hide `effected:build` from consumers.** Then only this repository could use it, and the point is that a consumer building with the kit gets the kit's chain.

## Consequences

- **A consumer moving to `effected package build` rewrites `catalog:build` to `catalog:effected:build`** for these packages; the upgrade ledger carries the entry.
- **Export before you repoint, or the export cannot run.** A manifest that names `catalog:effected:build` before `pnpm-workspace.yaml` declares it fails every install with `ERR_PNPM_CATALOG_ENTRY_NOT_FOUND_FOR_SPEC`. `pnpm pnpm:export` fails the same way, because pnpm's `verifyDepsBeforeRun` installs before the script runs ([the gotcha](../gotchas/verify-deps-before-run.md)). This repository's own migration hit it, and the way out was to run the bin directly, `cd packages/pnpm-plugin-effected/lib/build && ../../node_modules/.bin/rolldown-pnpm-config export`, then `pnpm install`. A consumer installing the plugin as a config dependency is in the same position: move the plugin release first, then rewrite the manifests.
- **Silk's `tsdown>rolldown-plugin-dts` override still applies wherever silk is a configDependency, this repository included**, until silk drops it. The kit cannot remove another plugin's override.
- **The sync relies on the CLI's scoping.** An earlier script restored the `effected:build` block after `--yes` and filtered `--check`'s drift, because the CLI honoured `--catalog` only interactively; that workaround was removed once 2.4.5 scoped every mode. A downgrade below 2.4.5 would let the sync move the build chain again.

Amends [the one declared effected catalog](one-declared-effected-catalog.md) and [consumers see one catalog](consumer-catalog-fold.md). The module: [pnpm-plugin-effected](../modules/pnpm-plugin-effected.md).

[^issue-1277]: <https://github.com/spencerbeggs/effected/issues/1277>
[^silk-build]: `@savvy-web/pnpm-plugin-silk` 0.52.0, `pnpmfile.mjs`.
[^savvy-build]: `packages/pnpm-plugin-effected/lib/build/pnpm-config.plugin.ts`
[^pnpmfile]: `packages/pnpm-plugin-effected/src/pnpmfile.ts`
[^catalog-test]: `packages/pnpm-plugin-effected/__test__/catalog.test.ts`
[^sync-script]: `lib/scripts/catalog-sync.ts`
