---
type: Module
title: pnpm
description: Everything pnpm owns alone — its settings catalog, versioning block, overrides grammar, workspace file editor, release-age gate, catalogs and lockfile document — over the npm vocabulary it shares.
status: draft
kind: package
resource: ../../packages/pnpm
tags:
  - architecture
generated:
  by: "claude-code/sonnet-5.5"
  at: 2026-11-12T23:05:46Z
sources:
  - id: package-manager-model-design
    resource: ../../docs/superpowers/specs/2026-11-12-package-manager-model-design.md
integrity:
  generated:
    body: 8602a9e49f76de99
---

# pnpm

## Purpose

`@effected/pnpm` holds every concept that is pnpm's alone.[^package-manager-model-design] The owner's rule is that a concept that is one manager's alone lives in that manager's package, and a concept shared by several managers lives in the lowest package they all depend on, which is [npm](npm.md). pnpm's settings, `versioning` block and lockfile document are not shared with npm or bun, so they live here.

## Tier and dependency posture

Pure tier at the root: `effect` is the only peer, `@effected/npm` the only dependency, no IO. The dependency direction is `npm <- pnpm` and `npm <- bun`, then both `<- lockfiles <- workspaces`, with `pnpm <- workspaces` as well. No manager package depends on `lockfiles` or `workspaces`; `lockfiles` imports each manager's native document schema and owns the normalisation into its common model. The package sits one layer above `npm` and below `lockfiles` in `lib/configs/layers.json`.

## Planned contents

- The settings catalog: every pnpm 12 setting as an Effect schema with its kind, description, the places it may be set and a docs anchor.
- The `versioning` block schema (`fixed`, `ignore`, `maxBump`, `lanes`, `epics`, `changelog`).
- The `overrides` key grammar and the `peerDependencyRules` shapes.
- `PnpmSettings`, the merged read of env, `pnpm-workspace.yaml` and global `config.yaml` in pnpm's precedence order, with typed reads through the catalog.
- The `pnpm-workspace.yaml` editor, which keeps formatting and writes keys in a canonical order.
- `ReleaseAgeGate`, `CatalogSet` with the `catalog:` protocol and `CatalogResolver`, and `WorkspaceResolver`, unless bun's definition proves identical, in which case the shared part stays in `npm`.
- The `pnpm-lock.yaml` document grammar, `PnpmExtension` and `PnpmEnvLockfile`.

Policy over the catalog (merge strategy, enforcement, the catalog-to-overrides directive) stays outside this package.

## The `/settings` subpath

The settings catalog is one large object a bundler cannot tree-shake, so it ships from the `@effected/pnpm/settings` subpath and the root entry never reaches it. A bundle-reachability test pins that, so a consumer that wants only the overrides grammar or the lockfile document does not pay for the catalog. `lockfiles` and `changesets` must not reach the subpath unless they use it.

## Current state

The package is scaffolded: the root entry is empty and the modules above move in from `npm`, `workspaces` and `lockfiles`.

[^package-manager-model-design]: `docs/superpowers/specs/2026-11-12-package-manager-model-design.md`
