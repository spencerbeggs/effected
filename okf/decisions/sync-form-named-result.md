---
type: Decision
title: "The sync form is named `*Result`, never `*Sync`"
description: "The kit spells a pure boundary's synchronous twin `*Result`, reserving `*Sync` for genuinely IO-performing sync facades."
status: draft
tags:
  - architecture
  - dx
  - compat
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 53744903cc1e476a
---

# The sync form is named `*Result`, never `*Sync`

## Context

The [sync-primitive policy](../conventions/sync-primitive-policy.md)
established that a pure kit boundary derives an `Effect` form from a
synchronous primitive. Naming that primitive needed a single answer, chosen
before it shipped on published surfaces across many packages.

## Decision

The sync form is spelled `*Result`, never `*Sync`, on three arguments in
ascending order of force:

1. **Precedent.** `*Result` is where the policy started and what the kit's
   own skills already name.
2. **Accuracy.** `Sync` names a distinction that does not exist — the
   `Effect` form in scope for this policy is also synchronous (`R = never`,
   no async step, no IO), which is the entire premise of the policy.
   `Result` names the one thing that actually differs between the two forms:
   the return type.
3. **`*Sync` is already taken in this kit, for an incompatible meaning.**
   `@effected/workspaces` ships a sync facade family
   (`findWorkspaceRootSync`, `getWorkspacePackagesSync`, `readPackageSync`)
   whose members are genuinely IO-performing functions returning nullables,
   not `Result`s. Within one kit, `*Sync` would mean both "does blocking IO,
   returns a nullable" and "pure computation, returns a `Result`" —
   indistinguishable from the name alone.

The rule holds even where the `Effect` twin is not merely a span wrapper.
`@effected/jsonc`'s `JsoncFingerprint.hash` requires core's `Crypto.Crypto`,
so its synchronous twin, `hashResult`
(`packages/jsonc/src/JsoncFingerprint.ts:483`), is not a free derivation — it
takes the digest from the caller instead of the service. Argument 2 does not
strictly apply here, since the `Effect` form really is the effectful one, but
arguments 1 and 3 still hold: `Result` is what the kit's readers have been
taught to look for, and `*Sync` would still collide with the workspaces
meaning. A sync twin that needs the caller to supply the platform is named
for its return type like every other one, and takes that platform as an
explicit argument rather than importing `node:*` — the
`TsconfigLoaderSyncOptions` shape
(`packages/tsconfig-json/src/TsconfigLoaderSync.ts:91`), carrying a
consumer-supplied `SyncFileSystem` and `SyncPath`, is the worked example.

This decision is the [format-package
convention](../conventions/format-package-convention.md)'s naming decision
generalized past formatting: `PackageJsonFormat.sortValue` and
`.formatToString` name their own shapes rather than borrowing `*Result`,
because they are total, not fallible-and-sync; `*Result` names the fallible
case specifically.

## Alternatives rejected

**`*Sync`.** Rejected on the naming-collision argument above:
`@effected/workspaces`'s existing sync facade family already uses `*Sync` for
a different contract (real IO, nullable return), and reusing the suffix for
"pure, `Result`-returning" would make the name lie about one of the two
meanings depending on which package a reader last read.

**A generic wrapper name unrelated to the return type, such as `*Pure`.**
Rejected as strictly less useful than naming the return type directly:
`Result` tells a reader exactly what to expect from the call, where `Pure`
only tells them what the call is not.

## Consequences

Every pure boundary's synchronous twin in the kit is discoverable by grepping
for the `*Result` suffix, and that grep is stable because `*Sync` is reserved
for a different, IO-performing contract. A package introducing a new
IO-performing synchronous facade uses `*Sync`; a package deriving a
synchronous primitive under the [sync-primitive
policy](../conventions/sync-primitive-policy.md) uses `*Result` regardless of
whether the derivation is free or takes an explicit platform argument.
