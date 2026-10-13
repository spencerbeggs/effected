---
type: Gotcha
title: The Catalog Sync check goes RED when it found and fixed drift
description: A red "Catalog Sync" check run on a PR to main usually means the automation found drift, repaired it, and committed the fix — not that anything is broken. The job also checks out and commits to main itself, so a feature branch's own PR never shows the catalog diff.
status: stable
resource: ../../.github/workflows/catalog-sync.yml
stale_after: "2027-03-13T00:00:00Z"
tags:
  - ci
  - release
sources:
  - id: catalog-sync-workflow
    resource: ../../.github/workflows/catalog-sync.yml
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 7d8f5e1c0b8dbe0b
---

# The Catalog Sync check goes RED when it found and fixed drift

## What a reader sees

The `Catalog Sync` check run on a pull request reports **failure**, with
a title like "Catalog was out of date — synced" and a summary naming a
commit that was just pushed to `main`.

## What they would wrongly conclude

That the sync automation is broken, that the release is now blocked, or
that a re-run is needed to fix something. A maintainer seeing red often
assumes the job failed to do its job.

## What is actually true

The check answers "was the catalog correct **at this ref**," not "did the
automation cope." When `catalog:check` (the read-only gate, run first,
with `continue-on-error: true` so its exit code survives as a signal)
finds drift, the job's remediation (`catalog:sync`) runs anyway and
repairs it, committing the fix straight to `main` via
`createCommitOnBranch`.[^catalog-sync-workflow] The check-run step then
deliberately reports **failure**, because a run that silently fixes
drift and reports green teaches nobody that the drift ever happened. The
summary names the repair commit, so the failure is informative — it goes
green on a re-run once that sync commit is already in the branch being
checked, because at that point the catalog really is correct at that ref.

Two further properties of the same job compound the confusion, and
neither is a bug:

- **It checks out `ref: main` and commits to `main`, not to the PR's own
  head.**[^catalog-sync-workflow] The job uses the pull-request event
  purely as a trigger to keep `main`'s catalog fresh; it does not
  validate the contents of the PR that triggered it. A feature branch's
  own pending changesets reach the catalog only once that branch merges,
  so the branch's own PR page never shows a catalog diff, even while the
  `Catalog Sync` check run appears on it.
- **The trigger fires on pull requests to `changeset-release/main` as
  well as to `main`**,[^catalog-sync-workflow] which is what puts this
  job in the release path — opening the release PR is itself what
  triggers the sync that lands inside that PR before anything publishes.

## The check

Before assuming anything is broken:

1. Read the check run's summary, not just its color. "Catalog was out of
   date — synced" plus a commit link means the repair already landed —
   there is nothing further to do except let the next run go green.
2. If a re-run of the same PR's check still reports red with a *new*
   drift finding, or reports "Catalog check and sync disagree," that is
   the genuinely broken case — the two halves of the job disagreeing
   means one of them is wrong.
3. Never read this check's failure as blocking a release by itself: the
   separate `on-build: pnpm catalog:check` gate in
   `.github/workflows/release.yml` is the actual release blocker, and it
   only fails when the catalog is genuinely still wrong at release time,
   not because a prior sync run happened to repair something.

[^catalog-sync-workflow]: `.github/workflows/catalog-sync.yml:5,56,281`
    — the `branches: [main, changeset-release/main]` trigger, the
    `ref: main` checkout, and the check-run step's `"Catalog was out of
    date — synced"` failure branch.
