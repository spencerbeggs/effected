---
type: Gotcha
title: pnpm:export keeps a catalog the plugin no longer declares
description: "rolldown-pnpm-config export merges the plugin's declared catalogs over the ones already in pnpm-workspace.yaml, so a catalog removed from savvy.build.ts survives the export as an orphan that still resolves; delete it from the root pnpm-workspace.yaml by hand."
status: draft
resource: ../../pnpm-workspace.yaml
stale_after: "2027-05-01T00:00:00Z"
tags:
  - deps
  - dx
sources:
  - id: merge-strategy
    resource: https://github.com/spencerbeggs/rolldown-pnpm-config/blob/main/package/src/runtime/strategies/catalogs.ts
    title: "The catalogs merge strategy: the existing catalogs are copied first, then each declared one is merged in"
  - id: owner
    resource: conversation with the repository owner
    author: human:spencer
    last_modified: "2026-11-01T00:00:00Z"
    title: "The orphaned effect and effect:peers blocks were removed by hand after the catalog merge"
generated:
  by: "okfit/claude-code"
  at: 2026-11-01T21:43:51Z
integrity:
  generated:
    body: 866141fb05e3f098
---

# pnpm:export keeps a catalog the plugin no longer declares

## What a reader sees

After a catalog is removed from `packages/pnpm-plugin-effected/savvy.build.ts` and the user runs `pnpm pnpm:export`, the export reports success, yet the root `pnpm-workspace.yaml` still carries the removed catalog's block. A manifest still naming it keeps installing.

## What they wrongly conclude

That the export did not run, or that the plugin still declares the catalog somewhere, and that running the export again will clear it.

## What is actually true

The export is a merge, not a replace. Its catalogs strategy starts from the catalogs already in the workspace file and merges each declared catalog over them, so a catalog the plugin no longer declares is left untouched.[^merge-strategy] Re-running the export changes nothing. When the plugin merged its two declared catalogs into one, the old `effect` and `effect:peers` blocks survived the export this way and had to be removed by hand.[^owner] See [the one declared effected catalog](../decisions/one-declared-effected-catalog.md).

The orphan is worse than clutter: it keeps a stale `catalog:` reference resolving here, so a manifest that a consumer could no longer install still passes this repository's own install.

## The fix

After removing a catalog from `savvy.build.ts` and running `pnpm pnpm:export`, delete that catalog's block (and its `:peers` twin) from the root `pnpm-workspace.yaml` by hand, then grep the workspace manifests for the old `catalog:` name. A remaining reference fails the next install, which is the signal that the removal is complete.

[^merge-strategy]: <https://github.com/spencerbeggs/rolldown-pnpm-config/blob/main/package/src/runtime/strategies/catalogs.ts>
[^owner]: Conversation with the repository owner, 2026-11-01.
