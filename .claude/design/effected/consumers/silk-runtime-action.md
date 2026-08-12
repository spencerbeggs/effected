---
status: current
module: effected
category: feedback
created: 2026-07-25
updated: 2026-08-12
last-synced: 2026-08-12
completeness: 88
related:
  - README.md
  - ../packages/github-actions.md
  - ../packages/commands.md
  - ../packages/glob.md
  - ../packages/runtimes.md
  - ../github-action-canon.md
---

# silk-runtime-action

## Overview

`/Users/spencer/workspaces/savvy-web/silk-runtime-action` provisions a job's toolchain — Node, Bun, Deno and a raw Biome binary — restores the dependency cache, and stands up an embedded Turbo remote-cache server backed by either the Actions cache or an S3-compatible bucket.

It is the only consumer that touches the **runner-local half** of `@effected/github-actions` and nothing else: no GitHub API services, no publishing, no supply chain. It is one of the three actions the [action canon](../github-action-canon.md) was derived from.

## What it exercises

Four capabilities exist in the kit because this action needed them, and it remains their only consumer:

- **`BlobStore` and the blob envelope.** The Turbo cache stores artifacts with caller-owned metadata; the envelope's magic prefix, version byte and typed decode failures replace a fixed 8-byte header whose truncated frames decoded silently to `null`. `BlobStore.layerGitHubCache` and the S3 backend both run here.
- **`DetachedProcess`.** The Turbo server is a long-lived child whose pid outlives the phase that spawned it, so spawn, readiness-probe and reap are all kit members rather than hand-rolled `node:child_process` and `process.kill` guards. `awaitReady` is the poll-until-domain-predicate that replaced a self-recursive retry.
- **`ToolInstaller` and `ActionCache` / `CacheKey`.** A real toolchain provisioner — download, extract, cache — plus the primary-key-and-restore-ladder derivation that a dependency cache needs.
- **`Secret.forChildEnv`.** A secret crossing a process boundary into the detached server, masked as it is declassified rather than declassified and then masked separately.

**`CacheKey.hashFiles` is provisionally housed.** It lives in `@effected/github-actions` because this is its only consumer; a second, non-Actions consumer moves it to a hashing package or into `walker` once core grows a digest contract.

## Where the kit's edge sits

- **The Turbo remote-cache protocol** — `/v8/artifacts` routing, the `x-artifact-tag` and `x-artifact-duration` semantics, and the raw `node:http` server. The kit owns framing and storage; Turbo's contract is this repo's domain.
- **`src/descriptors/`** — per-runtime download URLs, archive shapes and platform/arch binary-name maps. `ToolInstaller` provides the mechanism; which URL to fetch is policy.
- **`src/turbo-server.ts`'s own runtime.** A detached server legitimately builds its own Effect runtime rather than entering through `Action.run`, which is a phase entry point. Two bootstrap paths here is the design, not a gap.
- **Backend selection** by environment, and the single-raw-binary Biome install that drives `ToolInstaller` primitives directly rather than through the archive path.

## Open questions

1. **`@effected/runtimes` and the descriptors do not meet.** This action installs Node, Bun and Deno from hand-maintained descriptors while `@effected/runtimes` resolves semver-compatible versions for exactly those three. Nothing decides whether the descriptors should consume it, and installation is not a `github-actions` concern — so the seam has no owner.
2. **The runner-local half has one consumer.** Everything in the first section above is validated by this action alone.
