---
type: Runbook
title: Close a catalog membership gap
description: When catalog:check fails naming a package missing from the effected catalog, add its entry by hand at the PnpmConfigPlugin(...) call site — the tool refuses to guess a first-release range. A ripple-version gap needs no hand edit at all; the next catalog:sync closes it on its own.
status: stable
tags:
  - release
  - ci
sources:
  - id: catalog-sync-script
    resource: ../../lib/scripts/catalog-sync.ts
  - id: pnpm-plugin-effect-savvy-build
    resource: ../../packages/pnpm-plugin-effect/savvy.build.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 8f3c8e2771980cd9
---

# Close a catalog membership gap

## Trigger

`pnpm catalog:check` fails and its output names one or more packages
missing from the `effected` catalog literal — a **membership gap**, not
ordinary version drift. This happens when a new publishable package has
been added to `packages/*` (its `publishConfig.access === "public"`) but
has not yet been added to the catalog `PnpmConfigPlugin(...)` call in
`packages/pnpm-plugin-effect/savvy.build.ts`.[^pnpm-plugin-effect-savvy-build]

Membership is not something `pnpm catalog:sync` can close by running
again: the upstream `rolldown-pnpm-config upgrade` CLI walks the catalog
**literal**, so a package the literal never named is invisible to a walk
of it, no matter how many times the walk runs. `sync` detects the same
gap `check` does and refuses to write anything rather than committing a
changeset for a catalog it knows is still incomplete.[^catalog-sync-script]

## Steps

1. Run `pnpm catalog:check` and read its output — it names exactly which
   package(s) are missing from the catalog.
2. Open `packages/pnpm-plugin-effect/savvy.build.ts` and find the inline
   `PnpmConfigPlugin({ ... })` call. Do not move this literal into a
   separate `const`; the upstream CLI locates it by statically walking
   this exact call argument.
3. Add an entry for the missing package by hand, choosing its `range`,
   `peer` and `strategy`. This is a judgement call, not a derivation: for
   a package's first release, there is no existing published version the
   tooling can read to infer a starting range. Match the shape of the
   other `effected` catalog entries already present (`lock-minor`
   strategy, `source: "workspace"`).
4. Run `pnpm catalog:check` again to confirm the membership gap is
   closed. If version drift remains (the entry you just added does not
   yet match the package's real next-release version), run
   `pnpm catalog:sync` to resolve that ordinary drift.
5. Commit the manifest edit and let `catalog:sync`'s own changeset (if
   one was written) travel with it.

## A ripple-version gap needs no hand step

A **ripple bump** — a package that changesets bump only as a dependency
ripple, carrying no changeset of its own naming it directly — produces a
different-looking but self-closing gap. The upstream upgrade CLI resolves
`source: "workspace"` entries from the package manifest plus pending
changesets, and a ripple has no changeset naming it, so the CLI leaves
its catalog entry at the old version even after the catalog already knows
about the package (no membership gap, just stale version data for an
already-known member).

`catalog:sync` closes this on its own: it asks `changeset status
--output` for the real release plan, ripples included, and rewrites the
affected entries' `range`, flooring the `peer` patch under
`lock-minor`.[^catalog-sync-script] **Never hand-edit a ripple entry** —
the next `catalog:sync` run overwrites whatever you wrote, and a
`lock-minor` floor adjustment (for example normalizing `^0.11.1` down to
`^0.11.0`) is the correct output of that rewrite, not drift to repair
back.

## Observable end state

`pnpm catalog:check` exits zero: every publishable package
(`publishConfig.access === "public"`) is named in the `effected` catalog
literal, and every named entry's version matches that package's actual
next-release resolution, ripples included.

[^catalog-sync-script]: `lib/scripts/catalog-sync.ts:348-350,567` — the
    `missingFromCatalog` membership computation and the ripple-drift
    message: "These carry no changeset of their own, so the upgrade CLI
    cannot see them. Run `pnpm catalog:sync`."
[^pnpm-plugin-effect-savvy-build]: `packages/pnpm-plugin-effect/savvy.build.ts:11-20`
    — the inline `PnpmConfigPlugin({ ... })` call where a new entry is
    added by hand.
