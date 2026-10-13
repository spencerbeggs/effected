---
type: Consumer
title: silk-runtime-action
description: "The kit's only consumer of the runner-local half of github-actions: toolchain provisioning, dependency-cache restore, and an embedded Turbo remote-cache server."
repository: savvy-web/silk-runtime-action
status: stable
tags: [ci, performance]
generated:
  by: okfit/claude-code
  at: 2026-09-13T05:33:04Z
sources:
  - id: repo
    resource: "https://github.com/savvy-web/silk-runtime-action"
integrity:
  generated:
    body: 4f46c3f1264b3b95
---

# silk-runtime-action

`savvy-web/silk-runtime-action` provisions a job's toolchain — Node, Bun and
Deno, plus raw binaries for Biome, bats and kcov — restores the dependency
cache, and stands up an embedded Turbo remote-cache server backed by either
the Actions cache or an S3-compatible bucket.

It is the only consumer that touches the runner-local half of
[`@effected/github-actions`](../modules/github-actions.md): no GitHub API
services, no publishing, no supply chain. Its `package.json` dependencies
confirm the remaining reach is small and pure —
[`@effected/lockfiles`](../modules/lockfiles.md),
[`@effected/npm`](../modules/npm.md),
[`@effected/workspaces`](../modules/workspaces.md),
[`@effected/jsonc`](../modules/jsonc.md),
[`@effected/semver`](../modules/semver.md) and
[`@effected/commands`](../modules/commands.md), all in service of deciding
what to cache and which package manager to pin. This register was last
verified against the local checkout at
`/Users/spencer/workspaces/savvy-web/silk-runtime-action` on 2026-09-02.

## What it exercises

Four capabilities exist in the kit because this action needed them, and it
remains their only consumer:

- **The [blob store and its envelope](../interfaces/actions-storage.md).**
  The Turbo cache stores artifacts with caller-owned metadata; the
  envelope's magic prefix, version byte and typed decode failures replace a
  fixed 8-byte header whose truncated frames used to decode silently to
  `null`. Backend choice is a layer and nothing above it knows — the
  GitHub-cache-backed layer or the S3-compatible layer, selected by this
  repository's own server config.
- **The detached-process primitive**, from the
  [runner-local runtime surface](../interfaces/actions-runtime.md). The
  Turbo server is a long-lived child whose pid outlives the phase that
  spawned it, so spawn, readiness-probe and reap are all kit members
  rather than hand-rolled `node:child_process` and `process.kill` guards.
  The kit's poll-until-domain-predicate helper replaced a self-recursive
  retry here.
- **Tool installation and the Actions cache primary-key-and-restore-ladder
  derivation**, also from the
  [runtime surface](../interfaces/actions-runtime.md). A real toolchain
  provisioner — download, extract, cache — plus the cache-key derivation a
  dependency cache needs.
- **Secret handling across a process boundary.** A secret crossing into the
  detached server is masked as it is declassified, rather than declassified
  and then masked separately.

**Cache policy is composed from pure kit facts.** This repository's cache
configuration step decides what the dependency cache is keyed on and what
it covers by composing [`@effected/lockfiles`](../modules/lockfiles.md)'s
filename-lookup with [`@effected/npm`](../modules/npm.md)'s
package-manager cache-location facts — lockfile names on one side of the
seam, store locations on the other — and then lays out the key with the
kit's [cache-key builder](../interfaces/actions-runtime.md). The result is
total and host-argument-driven, so a test pins the Windows store paths
without a runner, a filesystem or a mocked `process`.

**The cache-key hash-files helper is housed by its consumer, not its
nature.** It lives in [`@effected/github-actions`](../modules/github-actions.md)
because this is its only consumer; a non-Actions consumer would be the case
for moving it somewhere purer.

## Where the kit's edge sits

- **The Turbo remote-cache protocol** — its artifact route, the
  artifact-tag and artifact-duration header semantics, and the raw
  `node:http` server. The kit owns framing and storage; Turbo's contract is
  this repository's domain.
- **Per-tool download URLs, archive shapes and platform/arch binary-name
  maps.** The tool-installer mechanism is the kit's; which URL to fetch is
  policy.
- **The detached Turbo server's own Effect runtime.** It legitimately
  builds its own runtime rather than entering through the kit's standard
  action entry point, because it is not itself a phase entry point. Two
  bootstrap paths here is the design, not a gap.
- **Backend selection by environment**, and the single-raw-binary installs
  (Biome, bats, kcov) that drive the tool-installer primitives directly
  rather than through the archive path.

## Open questions

1. **`@effected/runtimes` and this repository's descriptors do not meet.**
   This action installs Node, Bun and Deno from hand-maintained
   descriptors while [`@effected/runtimes`](../modules/runtimes.md)
   resolves semver-compatible versions for exactly those three runtimes.
   Nothing decides whether the descriptors should consume it, and
   installation is not a `github-actions` concern — so the seam has no
   owner.
2. **The runner-local half has one consumer.** Everything in the first
   section above is validated by this action alone.
