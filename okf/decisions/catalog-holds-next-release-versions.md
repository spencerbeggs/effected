---
type: Decision
title: The effected catalog holds next-release versions, and the publish order follows
description: The effected catalog literal resolves each package's next published version rather than its current registry version, which imposes the publish order changesets → catalog:sync → publish and is enforced by a workflow that triggers on pull requests to changeset-release/main.
status: stable
tags:
  - release
  - ci
sources:
  - id: catalog-sync-workflow
    resource: ../../.github/workflows/catalog-sync.yml
  - id: catalog-sync-script
    resource: ../../lib/scripts/catalog-sync.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
  body_sha256: 7cbb286165ad1386fadecd650d41b3f7b4a3cbfd47ce0579cfae2cf67a5f6211
verified:
  - by: human:spencer
    at: 2026-10-09T16:29:07Z
---

# The effected catalog holds next-release versions, and the publish order follows

## Context

`@effected/pnpm-plugin-effect` publishes an `effected` catalog that
consumers resolve their `@effected/*` version ranges from. That catalog
could, in principle, hold either the versions currently on the registry
or the versions the packages are about to publish next. The choice
determines when the catalog needs to be correct relative to a release in
flight.

## Decision

The `effected` catalog resolves what each package's **next published
version will be**, not what is currently on the registry. A pending
`patch` changeset moves that package's catalog entry up a patch with no
manifest edit anywhere — the catalog is a projection of the pending
changesets, not of `packages/*/package.json`.

This forces a strict publish ordering: **changesets → `catalog:sync` →
publish**. Consumers take their `@effected/*` ranges from the published
catalog, not from any manifest in this repository, which makes the sync
a release step rather than mere hygiene. Publishing a wave without
running `catalog:sync` first would leave the catalog naming the previous
versions, so a downstream consumer that unlinks its local overrides would
resolve a registry copy without the new API on ranges that still look
satisfied — green the whole way through and wrong only at the very end,
surfacing to that consumer as a missing export discovered in CI, one repo
removed from anything that could explain it.

The ordering is enforced by CI rather than left as a step to remember.
`.github/workflows/catalog-sync.yml` triggers on pull requests to `main`
**and to `changeset-release/main`**,[^catalog-sync-workflow] so opening
the release PR is itself the trigger: the job runs the catalog-sync
script,[^catalog-sync-script] which syncs the catalog and writes
`.changeset/catalog-sync.md` inside the release PR, before anything
publishes. Nobody runs `catalog:sync` by hand ahead of a release.

`.changeset/**` counts as a real version source for this reason —
`packages/pnpm-plugin-effect/turbo.json` restates `$TURBO_ROOT$/.changeset/**`
as a build input on both `build:dev` and `build:prod`, because the
plugin's build reads versions from outside its own package directory and
turbo's defaults do not describe that dependency by default.

## Alternatives rejected

- **The catalog holds the current registry version**, updated only after
  each package's own release lands. Rejected because it reintroduces
  exactly the ordering hazard this decision exists to close: a consumer
  resolving the catalog mid-release would see stale ranges precisely
  during the window when the new versions are about to become available,
  with no mechanism forcing the catalog to update in step.
- **Re-sync after `changeset version` runs, inside the release
  workflow**, where ripple versions first become concrete. Rejected
  because that workflow lives in another repository (the reusable
  release workflow), and a sync run from there would write a changeset
  that re-versions the release already in flight.

## Consequences

A `lock-minor` strategy floors peer patches on catalog entries, so a
first sync normalizing `^0.11.1` down to `^0.11.1`'s floor `^0.11.0` is
the correct output of the rewrite, not drift to repair back. The chain
this ordering protects does not actually end at the registry: it ends in
a consumer's resolved tree, and that last link belongs to the consumer.
A consumer's `configDependencies` pin on `@effected/pnpm-plugin-effect`
can stay stale long after a correct release publishes, so "the packages
published" and "the published plugin's catalog names them" can both be
true while "the consumer's tree resolves them" is still false — the
terminal check is always the resolved tree
(`node_modules/@effected/<pkg>/package.json`'s `version` after install),
never the registry or the catalog alone.

[^catalog-sync-workflow]: `.github/workflows/catalog-sync.yml:4-6` — `on:
    pull_request: branches: [main, changeset-release/main]`.
[^catalog-sync-script]: `lib/scripts/catalog-sync.ts` — the script the
    workflow runs; see [the catalog-sync CLI](../interfaces/catalog-sync-cli.md)
    for its full command surface.
