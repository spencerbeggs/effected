---
type: Decision
title: "@effected/vfs is deferred until a second consumer materializes"
description: A generic node_modules/-prefixed virtual filesystem with merge/prefix helpers and an environment seam is decided-but-unbuilt; it ships only when a second VFS consumer appears beyond the TypeScript-tooling one that motivated its shape, never speculatively.
status: draft
tags:
  - architecture
sources:
  - id: package-json-license
    resource: ../../packages/package-json/src/License.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: cbc868d3fa576166
---

# @effected/vfs is deferred until a second consumer materializes

## Context

`type-registry-effect` — the external repository that stays outside the
kit because it carries `typescript`/`@typescript/vfs`
peers — motivated the shape of a `Vfs` keyed by `node_modules/`-prefixed
paths, with merge/prefix helpers and an environment seam. That shape is a
flavor of a generic virtual filesystem rather than the whole of it: it
was designed against exactly one consumer's needs, and generalizing it
into a kit package before a second consumer exists risks locking in an
API shaped by one caller's peculiarities.

## Decision

`@effected/vfs` is decided-but-unbuilt. It ships only when a **second**
VFS consumer materializes beyond the TypeScript-tooling one that
motivated the shape — never speculatively. The kit's evidence-gated
posture for new packages applies here specifically: a package or
capability enters when a named consumer needs it, not ahead of demand.
This is the same posture that governs every other still-open workstream
in the kit — for example the `@effected/spdx` package existed only once
a real consumer (`package-json`'s license validation) needed vendored
SPDX license expressions rather than being built ahead of that need.[^package-json-license]

## Alternatives rejected

- **Build the generic `Vfs` now, ahead of a second consumer**, on the
  theory that a virtual-filesystem abstraction is obviously reusable.
  Rejected because the only concrete shape available today is
  `type-registry-effect`'s TypeScript-specific one, and generalizing from
  a single data point risks over-fitting the API to that consumer's
  incidental choices rather than to what a second, different consumer
  would actually need.
- **Ship the `type-registry-effect`-specific shape as-is inside the kit**,
  treating it as good enough for a first release. Rejected for the same
  reason `type-registry-effect` itself stays outside the kit: its
  `typescript`/`@typescript/vfs` peers would violate the kit's
  no-`@effected/*`-package-imports-`typescript` posture.

## Consequences

No package named `@effected/vfs` exists in the workspace today. Anyone
proposing to build it should first identify the second, independent
consumer whose needs justify generalizing beyond the TypeScript-tooling
shape — absent that, the right answer is still "not yet," regardless of
how reusable the abstraction looks in isolation.

[^package-json-license]: `packages/package-json/src/License.ts` — the
    package that delegates SPDX validity to `@effected/spdx`, the worked
    example of a capability arriving only once a real consumer needed it
    rather than speculatively.
