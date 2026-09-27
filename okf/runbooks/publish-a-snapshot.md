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
  at: 2026-09-27T06:21:10Z
  body_sha256: dbd66ba57aaa4798cdd93ad8a4edbb0b99434596cc4f1158d793242731a53c50
---

# Publish a snapshot

## Trigger

A consumer needs unreleased kit changes on a runner, usually because its own fixtures only run on a pull request. A `file:` link works on one machine but can't install on a runner, and the dogfood push guard refuses a PR while one is present. The [link runbook](link-a-consumer-to-an-unreleased-kit.md) covers local adoption; this runbook covers getting the same changes onto CI.

## Steps

1. **Push the branch.** The snapshot is built from what the branch has committed, including its pending changesets, not from anyone's working tree.
2. **Dispatch the snapshot job** from that branch: `gh workflow run release.yml --ref <branch> -f snapshot=true` (add `-f snapshot_tag=<tag>` for a tag other than `next`). The job refuses to run from `main`, and it refuses the `latest` tag.
3. **What the job does:**
   - It runs `changeset version --snapshot <tag>` with `useCalculatedVersion`, so versions read `<next release>-<tag>-<datetime>` (for example `0.12.0-next-20260927051500`).
   - It builds through `ci:build`, then publishes every public npm-target package the snapshot bumped from its `dist/prod/npm/pkg`, using `--tag <tag> --provenance`.
   - It never commits or pushes the version bump.
   - Trusted publishing (OIDC) applies because the job lives in `release.yml`, and `NPM_TOKEN` is the fallback.
4. **Copy the overrides block** from the job summary into the consumer's `pnpm-workspace.yaml`. It holds exact registry versions, not `file:` links, so the push guard allows the PR.
5. **Before the consumer merges**, replace the snapshot pins with the real release: bump the `@effected/pnpm-plugin-effect` catalog pin and drop the lockfile (see the dogfood `--exit` step).

## Limits

- **A package the registry has never seen is skipped**, with a warning in the job log. A first publish under a non-latest tag would also claim `latest`, so the first publish belongs to the real release. If a published snapshot depends on a skipped package, it can't install. Release that package first.
- **Snapshots publish ripple bumps too.** Every package the plan bumps is published, including patch bumps pulled in only because a dependency moved. Check `changeset status` before dispatching to see the set.
- **The `effected` catalog doesn't carry snapshot versions**, and `@effected/pnpm-plugin-effect` is not snapshot-published. Consumers pin snapshots with `overrides:`, which replace the catalog's resolution outright.

## Done when

The job summary lists every expected `name@version`, and `npm view "<name>@<version>" version` resolves for each one.
