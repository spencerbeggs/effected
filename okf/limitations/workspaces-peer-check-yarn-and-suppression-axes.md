---
type: Limitation
title: PeerCheck cannot answer yarn
description: "Deprecated: yarn is an unsupported manager, so PeerCheck never reads a yarn lockfile; the supported false report remains for any lockfile format outside its allowlist."
status: deprecated
bounds: ../interfaces/workspaces-peer-check.md
tags:
  - architecture
  - testing
sources:
  - id: peer-check-ts
    resource: ../../packages/workspaces/src/PeerCheck.ts
generated:
  by: "okfit/claude-code"
  at: 2026-11-13T06:27:13Z
integrity:
  generated:
    body: ff8e1532b960439d
---

# PeerCheck cannot answer yarn

## Condition

`PeerCheck.run` reads a parsed `@effected/lockfiles` `Lockfile`, and a
format outside its allowlist of peer-resolving formats (`npm`, `pnpm`,
`bun`) reports `supported: false` rather than an empty, falsely clean
`unsatisfied` list. That limit was first met for yarn, whose lockfile records
no join between a peer declaration and the instance that satisfied it.

## Current state

Yarn is not a supported manager and `@effected/lockfiles` no longer parses
its lockfile, so a yarn repository never reaches `PeerCheck`: detection
refuses it first
([support policy](../conventions/package-manager-support-policy.md)). The
`supported: false` report and its allowlist remain, so a lockfile format
added later is unsupported until a parser records its peer resolution. The
matching rules and the suppression axes are in
[the peer-check interface](../interfaces/workspaces-peer-check.md).
