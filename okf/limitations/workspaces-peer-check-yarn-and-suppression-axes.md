---
type: Limitation
title: PeerCheck cannot answer yarn
description: PeerCheck reports supported false for yarn's virtual-locator peers, because the yarn lockfile records no join between a peer declaration and the instance that satisfied it.
status: stable
bounds: ../interfaces/workspaces-peer-check.md
tags:
  - architecture
  - testing
sources:
  - id: peer-check-ts
    resource: ../../packages/workspaces/src/PeerCheck.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-20T05:03:32Z
  body_sha256: 4ca5bf92c71eccf0ed6a74f2ae4e4895434bbadec6ab25c657b075c11fb65a7b
---

# PeerCheck cannot answer yarn

## Condition

`PeerCheck.run` reads a parsed `@effected/lockfiles` `Lockfile` and reports
unsatisfied peer dependencies through `instanceId`, `resolved`, and
`peerDependencies` alone, with no per-format branch.[^peer-check-ts] One
fact about the lockfile it reads limits what the report can say: yarn
resolves peers virtually, giving a peer-bearing package one `@virtual:`
locator per consumer with no record of which instance satisfied which
peer.

## Symptom

A caller running `PeerCheck.run` against a yarn lockfile gets back
`supported: false` rather than a populated `unsatisfied` list — there is no
row-level detail to inspect, because the lockfile carries no join key
between a peer declaration and the instance that satisfied it.

## Why this is acceptable

Yarn's plug-and-play resolution genuinely does not record what a checker
would need: the lockfile-only design this checker commits to (reading the
resolved graph rather than shelling out to a package manager's own peer
command, which does not exist for bun and hard-fails before inspection for
npm) cannot manufacture a join yarn itself does not persist. `supported:
false` states that limit rather than returning an empty, falsely-clean
result — a bare array would make "yarn cannot be checked" indistinguishable
from "yarn has no violations", which is the more dangerous failure.

The suppression policy is no longer part of this limitation: all three
`peerDependencyRules` axes (`allowedVersions`, `ignoreMissing`, `allowAny`)
are applied, each established by measurement against `pnpm peers check`
with a firing control — see [the peer-check
interface](../interfaces/workspaces-peer-check.md) for the matching rules
and the fixtures that pin them.

## What the fix would take

Yarn support has no fix within this checker's architecture: it would
require a different, format-specific data source than the lockfile, which
is exactly the per-format branch this module's design forbids.

[^peer-check-ts]: `packages/workspaces/src/PeerCheck.ts` — `PeerCheck.run`,
    `UnverifiedReason`.
