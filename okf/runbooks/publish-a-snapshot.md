---
type: Runbook
title: Publish a snapshot
description: Publish a branch's unreleased kit versions under a non-latest dist-tag so a consumer's CI can install them from the registry.
status: draft
resource: ../../.github/workflows/release.yml
tags:
  - ci
  - release
generated:
  by: "okfit/claude-code"
  at: 2026-09-27T17:43:02Z
  body_sha256: cfde8e677870e1822e2f0f5b7c3b38b1a6d2eb1e6ac27ac48018a3978147712e
---

# Publish a snapshot

## Trigger

A consumer needs unreleased kit changes on a runner, usually because its own fixtures only run on a pull request. A `file:` link works on one machine but can't install on a runner, and the dogfood push guard refuses a PR while one is present. The [link runbook](link-a-consumer-to-an-unreleased-kit.md) covers local adoption; this runbook covers getting the same changes onto CI.

## Steps

1. **Push the branch.** The snapshot is built from what the branch has committed, including its pending changesets, not from anyone's working tree.
2. **Dispatch a snapshot** from that branch: `gh workflow run release.yml --ref <branch> -f snapshot=true` (add `-f snapshot_tag=<tag>` for a tag other than `next`, and `-f dry_run=true` to rehearse without publishing). effected's `release.yml` passes both inputs to the reusable `spencerbeggs/.github` release workflow, which runs silk-release-action's `snapshot` phase in its nested `release-snapshot.yml`. The phase refuses anything but a feature branch (it reads the full `GITHUB_REF`, so tags are refused), refuses the release and target branches, and refuses `latest`.
3. **What the phase does:**
   - It versions through changesets' snapshot machinery with `useCalculatedVersion`, so versions read `<next release>-<tag>-<datetime>` (for example `0.12.0-next-20260927051500`), and pins internal dependency ranges to the exact snapshot versions.
   - It builds through `ci:build`, then publishes every bumped package through silk-release-action's own publish-target resolution (`publishConfig` targets, per-target `directory` and `registry`), passing `--tag <tag>` on every upload.
   - It never commits or pushes the version bump, and it creates no git tag, GitHub release or release PR.
   - npm trusted publishing (OIDC) works through the nested reusable workflows; this was confirmed live, with the publisher recorded as `GitHubActions`. `NPM_TOKEN` stays the fallback. The caller must keep `id-token: write` and `packages: write`, because a nested job cannot exceed its caller's permissions.
   - A dry run versions, builds and packs, probes the registry, then skips every upload and reports the outcome `rehearsed`.
4. **Copy the overrides block** from the job summary into the consumer's `pnpm-workspace.yaml`. It holds exact registry versions, not `file:` links, so the push guard allows the PR.
5. **Before the consumer merges**, replace the snapshot pins with the real release: bump the `@effected/pnpm-plugin-effect` catalog pin and drop the lockfile (see the dogfood `--exit` step).

## Limits

- **A package the registry has never seen is skipped** (reported as `never-published` in the result). A first publish under a non-latest tag would also claim `latest`, so the first publish belongs to the real release. Only a confirmed 404 counts; any other registry error fails that target. If a published snapshot depends on a skipped or failed sibling, the job summary lists it under "Dangling dependencies", and that snapshot can't install until the sibling is released.
- **Snapshots publish ripple bumps too.** Every package the plan bumps is published, including patch bumps pulled in only because a dependency moved. Check `changeset status` before dispatching to see the set.
- **The `effected` catalog doesn't carry snapshot versions**, and `@effected/pnpm-plugin-effect` is not snapshot-published. Consumers pin snapshots with `overrides:`, which replace the catalog's resolution outright.

## Authority

- **The gate is repository write access.** Anyone who can dispatch a workflow here can publish a snapshot of any branch. This is deliberate: the job has no approval environment, and the maintainer chose that over a protected environment.
- **What limits the damage:**
  - The phase refuses `main`, non-branch refs and the `latest` tag, and never publishes a package the registry hasn't seen.
  - A snapshot dispatch has its own concurrency group in effected's caller, and the reusable workflow's snapshot job queues instead of cancelling, so another dispatch can't cancel one mid-publish.
- **A failure partway through leaves a partial set under the tag.** Consumers should pin the exact versions from the job summary rather than follow the dist-tag.

## Done when

The job summary lists every expected `name@version`, and `npm view "<name>@<version>" version` resolves for each one.
