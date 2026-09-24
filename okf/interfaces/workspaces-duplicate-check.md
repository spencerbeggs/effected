---
type: Interface
title: "@effected/workspaces duplicate-copy checking"
description: DuplicateCheck — a lockfile-only report of every package resolving at two or more versions and who pulls each copy, with the kit predicate that names the Layer-mismatch trap.
status: stable
kind: api
resource: ../../packages/workspaces/src/DuplicateCheck.ts
tags:
  - architecture
  - dx
sources:
  - id: duplicate-check-ts
    resource: ../../packages/workspaces/src/DuplicateCheck.ts
  - id: roots-ts
    resource: ../../packages/workspaces/src/internal/roots.ts
  - id: issue-298
    resource: https://github.com/spencerbeggs/effected/issues/298
  - id: issue-603
    resource: https://github.com/spencerbeggs/effected/issues/603
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T16:45:41Z
  body_sha256: dc9d9bdd2a38278b149304bcbb89d56a00707bf0df41aaf3fe79ddec60b1b1a0
verified:
  - by: human:spencer
    at: 2026-09-24T00:11:50.663Z
---

# @effected/workspaces duplicate-copy checking

`DuplicateCheck` answers one question over a parsed `@effected/lockfiles`
`Lockfile`: *which packages resolve at more than one version, and who pulls
each copy?* It is a pure value class on exactly
[`PeerCheck`](workspaces-peer-check.md)'s posture — no service, no layer,
nothing in `R`, no error channel, format-free, `instanceId` opaque — and
the two share one importer-to-instance join in `internal/roots.ts` so they
cannot disagree about which importers are answerable.[^duplicate-check-ts][^roots-ts]

## Why it exists

A duplicated `@effected/*` or `effect` copy never fails as itself. It
surfaces as a structural `Layer` mismatch at a consumer's entry point — a
`LocalExec` that is visibly provided yet "unsatisfied", because the
requirement came from one copy of `@effected/commands` and the provision
from another — or as a `TypeError` deep inside one `effect` copy formatting
an issue the other produced. Neither names a package or a version skew, and
the answer (`pnpm why`, looped over every kit package by hand) went unrun
for months at a stretch. Three consumers hit it six times before this
module existed.[^issue-298][^issue-603]

## The contract

- `DuplicateCheck.run(lockfile, { names? })` → `{ duplicates, unresolvedImporters, isClean }`.
  `duplicates` is a list of `DuplicatedPackage { name, versions }`, each
  version a `DuplicatedVersion { version, instances }`, each instance a
  `DuplicateInstance { instanceId, dependents }`, and each dependent either
  `{ _tag: "importer", path }` or `{ _tag: "package", name, version }`.
- **A duplicate is a name reached at two or more distinct versions.**
  Peer-suffix instances of one version are listed under that version but
  never make it a duplicate on their own: they are the same code, and only
  a version skew produces the trap above. Mutation-pinned.
- **Reachability is one global walk** from every importer's roots along
  `resolved` edges. A stale row the lockfile still carries but nothing
  reaches is not a duplicate; every reached edge is a dependent.
- **`names` narrows the report, never the walk.** The filtered-out package
  is exactly the culprit that must still appear as a dependent —
  `@effected/npm` pinning an old `@effected/commands` is the #298 case.
- **`DuplicateCheck.kit`** is `effect` plus `@effected/*` — not `@effect/*`,
  not `effect-*` — because that is the question every consumer of this kit
  actually asks.
- **Dependents are in lockfile order**, importers first, built from the
  lockfile rather than from the walk, so the order never depends on which
  importer happened to reach an instance first. An edge leaving a workspace
  row is attributed to the importer by path, never as a `package` named
  after a directory with a `"0.0.0"` placeholder.
- **`isClean` answers for the names asked about** and says nothing about
  `unresolvedImporters`; a gate wanting a proven-clean answer checks both.
  `unresolvedImporters` is the same npm/bun root-importer limitation
  `PeerCheck` documents, measured by the same code.

## Where it sits

The kit ships the value, not a command. A CLI's `deps check-duplicates`
belongs to a consumer (the `systems` silk CLI is the natural home); the
report renders to the one-call sketch in #603 directly. The IO half is
`LockfileReader.read()` — the same pairing `PeerCheck` uses.

[^duplicate-check-ts]: `packages/workspaces/src/DuplicateCheck.ts`
[^roots-ts]: `packages/workspaces/src/internal/roots.ts`
[^issue-298]: #298 — the Layer-mismatch and SchemaIssue-`TypeError` symptom classes.
[^issue-603]: #603 — the three silk-update-action sightings and the aggregation ask.
