---
type: Decision
title: "The typechecker: tsc, not tsgo"
description: Every package's types:check runs tsc --noEmit against catalog:build; @effect/tsgo is never added to a package even though the catalog entry still exists.
status: draft
tags:
  - dx
sources:
  - id: pnpm-workspace
    resource: ../../pnpm-workspace.yaml
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: cc228ae313d75923
---

# The typechecker: tsc, not tsgo

## Context

Every package's `types:check` script is `tsc --noEmit`, backed by
`typescript: catalog:build`. `@effect/tsgo` survives only as a
`pnpm-workspace.yaml` catalog entry with no consumer — a leftover from an
earlier direction rather than a live option.

## Decision

Do not add `@effect/tsgo` to a new package's `devDependencies`. Copying a
sibling package's manifest gets this right automatically, since no
sibling depends on it; this decision exists so nobody reintroduces it
from memory, reasoning that a `tsgo`-named catalog entry implies an
intended migration.

## Alternatives rejected

- **Adopt `@effect/tsgo` package-by-package as packages are scaffolded.**
  Rejected: the catalog entry is retained without an adoption plan behind
  it, and the root `tsconfig.json`'s `skipLibCheck: true` override exists
  specifically because a third-party package's declaration file breaks
  `tsc`'s root-program check, a class of failure a full migration to
  `tsgo` has not been evaluated against.

## Consequences

A `pnpm peers check` or catalog audit that finds `@effect/tsgo` listed
with zero consumers is expected state, not drift to repair. Removing the
catalog entry entirely is a separate, larger decision than this one and
has not been made.
