---
type: Limitation
title: Yarn carries no resolved peer edges
description: The yarn Berry parser records dependency edges only; peer-dependency resolution is never populated because yarn resolves peers virtually.
status: stable
bounds: ../modules/lockfiles.md
tags:
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: ffabc534129c2b4a
---

# Yarn carries no resolved peer edges

## Condition

A consumer parses a `yarn.lock` (Berry) file and looks for resolved peer-dependency edges on a `ResolvedPackage` row the way pnpm or npm rows might carry them.

## Symptom

Yarn's `resolved` field is populated for dependency edges only; there is never a resolved peer entry for a yarn-parsed package, even when the package genuinely declares and satisfies peer dependencies in the real install.

## Why this is acceptable

This is a documented gap, not an approximation the model got wrong: yarn resolves peer dependencies **virtually**, meaning the same declared package can be satisfied by different virtual instances in different parts of the dependency graph, and `yarn.lock` itself does not record which virtual instance satisfied which peer at any given position. There is no data in the lockfile text for this package to read and normalize — the information yarn's own lockfile format would need to record simply is not present, so populating this field for yarn would mean inventing an answer yarn itself does not have.

## What the fix would take

There is no fix available at the lockfile-parsing layer, since the missing information is not recoverable from `yarn.lock` content alone. A consumer needing yarn peer-resolution data would need to derive it from a live yarn install (for instance, via yarn's own introspection commands) rather than from static lockfile parsing, which is a fundamentally different data source than what this package works from.
