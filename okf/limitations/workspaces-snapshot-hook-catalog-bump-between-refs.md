---
type: Limitation
title: Under the no-op hooks layer, a hook-injected catalog's range bump between two refs is invisible to a snapshot diff
description: Under ConfigDependencyHooks.layerNoop (the default composites), WorkspaceStateSnapshot.crossSeed cannot surface a range change made purely by bumping a config dependency between two refs, because neither ref's committed sources declare the catalog; a replaying layer detects it.
status: stable
bounds: ../interfaces/workspaces-snapshots.md
tags:
  - architecture
sources:
  - id: workspace-state-snapshot-ts
    resource: ../../packages/workspaces/src/WorkspaceStateSnapshot.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-20T05:03:32Z
  body_sha256: 8711a818e98f977ca9935e7e4cb410c771dc1b42dcf783bbf7153758318c01c1
---

# Under the no-op hooks layer, a hook-injected catalog's range bump between two refs is invisible to a snapshot diff

## Condition

The snapshots were read under `ConfigDependencyHooks.layerNoop` — what
`Workspaces.layer` and `Workspaces.layerWithGit` wire — so
`WorkspaceSnapshots.at(ref)` executed no config-dependency code at either
ref, and `WorkspaceStateSnapshot.crossSeed(before, after)` is what lets a
`catalog:` specifier against a hook-injected catalog (one that exists only
because a pnpm config-dependency pnpmfile injects it, never recorded in
`pnpm-workspace.yaml` or the lockfile's `catalogs:` block) resolve at all
on the ref side.[^workspace-state-snapshot-ts] Each side's answer then
comes from the other side's seed, or from the importer-version fallback,
which answers with a version rather than a declared range.

## Symptom

When the config dependency was bumped between the two refs and its newer
pnpmfile declares a different range for a hook-injected catalog entry —
with no other change to either ref's committed sources — the diff reports
no row for that catalog specifier. The dependency table looks unchanged
even though the effective policy genuinely moved.

## Why this is acceptable

The no-op layer is the default precisely so the default composites execute
no config-dependency code, and a read that executes nothing cannot see a
catalog that exists only through execution. The case has a narrow,
identifiable blast radius: the catalog is not declared anywhere git can
already see.

## What the fix would take

Opting in. Under a replaying layer (`Workspaces.layerWithGitAndConfigDependencies`
or its subprocess twin) `at(ref)` replays each ref's `configDependencies`
at the version that ref declares — resolved through `node_modules/.pnpm-config`
when it holds that version and through the pnpm store otherwise, failing
closed when neither does — so each side's own catalogs carry its range and
the bump is a visible row. The store keeps every version installed on the
machine, which is what makes a past ref's pnpmfile reachable with no
checkout and no fetch. A consumer that must stay on the no-op layer diffs
the `configDependencies` block in `pnpm-workspace.yaml` directly, the only
committed signal that a hook-injected catalog's policy might have moved.

[^workspace-state-snapshot-ts]: `packages/workspaces/src/WorkspaceStateSnapshot.ts` —
    `crossSeed`, `withSeededCatalogs`, `seededCatalogs`.
