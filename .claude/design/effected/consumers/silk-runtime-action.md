---
status: current
module: effected
category: feedback
created: 2026-07-25
updated: 2026-09-02
last-synced: 2026-09-02
completeness: 88
related:
  - README.md
  - ../packages/github-actions.md
  - ../packages/commands.md
  - ../packages/lockfiles.md
  - ../packages/npm.md
  - ../packages/runtimes.md
  - ../github-action-canon.md
---

# silk-runtime-action

## Overview

`/Users/spencer/workspaces/savvy-web/silk-runtime-action` provisions a job's toolchain — Node, Bun and Deno, plus raw binaries for Biome, bats and kcov — restores the dependency cache, and stands up an embedded Turbo remote-cache server backed by either the Actions cache or an S3-compatible bucket.

It is the only consumer that touches the **runner-local half** of `@effected/github-actions`: no GitHub API services, no publishing, no supply chain. What it reaches outside that half is small and pure — `lockfiles`, `npm`, `workspaces`, `jsonc`, `semver` and `commands`, all in service of deciding what to cache and which package manager to pin. It is one of the three actions the [action canon](../github-action-canon.md) was derived from.

## What it exercises

Four capabilities exist in the kit because this action needed them, and it remains their only consumer:

- **`BlobStore` and the blob envelope.** The Turbo cache stores artifacts with caller-owned metadata; the envelope's magic prefix, version byte and typed decode failures replace a fixed 8-byte header whose truncated frames decoded silently to `null`. Backend choice is a layer and nothing above it knows — `GitHubCacheBlobStore.layer` or `BlobStore.layerS3`, selected in `src/turbo-cache/server-config.ts`.
- **`DetachedProcess`.** The Turbo server is a long-lived child whose pid outlives the phase that spawned it, so spawn, readiness-probe and reap are all kit members rather than hand-rolled `node:child_process` and `process.kill` guards. `awaitReady` is the poll-until-domain-predicate that replaced a self-recursive retry.
- **`ToolInstaller` and `ActionCache` / `CacheKey`.** A real toolchain provisioner — download, extract, cache — plus the primary-key-and-restore-ladder derivation that a dependency cache needs.
- **`Secret.forChildEnv`.** A secret crossing a process boundary into the detached server, masked as it is declassified rather than declassified and then masked separately.

**Cache policy is composed from pure kit facts.** `src/steps/cache-config.ts` decides what the dependency cache is keyed on and what it covers by composing `@effected/lockfiles`' `filenamesFor` with `@effected/npm`'s `PackageManagerCache` — lockfile names on one side of the seam, store locations on the other — and then lays out the key with `CacheKey`. The result is total and host-argument-driven, so a test pins the Windows store paths without a runner, a filesystem or a mocked `process`. This is the register's clearest case of pure kit vocabulary turning a runner-shaped decision into a testable function.

**`CacheKey.hashFiles` is housed by its consumer, not its nature.** It lives in `@effected/github-actions` because this is its only consumer; a non-Actions consumer would be the case for moving it somewhere purer.

## Where the kit's edge sits

- **The Turbo remote-cache protocol** — `/v8/artifacts` routing, the `x-artifact-tag` and `x-artifact-duration` semantics, and the raw `node:http` server. The kit owns framing and storage; Turbo's contract is this repo's domain.
- **`src/descriptors/`** — per-tool download URLs, archive shapes and platform/arch binary-name maps. `ToolInstaller` provides the mechanism; which URL to fetch is policy.
- **`src/turbo-server.ts`'s own runtime.** A detached server legitimately builds its own Effect runtime rather than entering through `Action.run`, which is a phase entry point. Two bootstrap paths here is the design, not a gap.
- **Backend selection** by environment, and the single-raw-binary installs (Biome, bats, kcov) that drive `ToolInstaller` primitives directly rather than through the archive path.

## Open questions

1. **`@effected/runtimes` and the descriptors do not meet.** This action installs Node, Bun and Deno from hand-maintained descriptors while `@effected/runtimes` resolves semver-compatible versions for exactly those three. Nothing decides whether the descriptors should consume it, and installation is not a `github-actions` concern — so the seam has no owner.
2. **The runner-local half has one consumer.** Everything in the first section above is validated by this action alone.
