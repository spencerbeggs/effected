---
type: Invariant
title: npm and bun rows never populate unresolvedEdges
description: "In @effected/lockfiles a declaration the positional walk does not find on an npm or bun row is genuine absence and stays out of unresolvedEdges; only pnpm and yarn, whose lockfiles record an edge the model may fail to name, ever fill the field."
status: stable
resource: ../../packages/lockfiles/__test__/Lockfile.test.ts
tags:
  - testing
sources:
  - id: npm-resolve-edges
    resource: ../../packages/lockfiles/src/internal/npm.ts
  - id: exemption-test
    resource: ../../packages/lockfiles/__test__/Lockfile.test.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-22T01:21:07Z
integrity:
  generated:
    body: 4e471246dd991c95
---

# npm and bun rows never populate unresolvedEdges

## The property

A `ResolvedPackage` parsed from `package-lock.json` or `bun.lock` always
carries `unresolvedEdges: []`. When the positional walk finds no key for a
declared name, the name is simply absent from `resolved` — it is never
reported as an edge the model could not name. pnpm and yarn rows are the
only ones that ever populate the field.

## Why it must hold

`unresolvedEdges` exists to separate "the lockfile records an edge this
model could not name" from "nothing is there", because
[`workspaces`' peer check](../modules/lockfiles.md) reads the field
one layer up as its fail-closed `"unresolvedEdge"` reason. That split only
carries information where the lockfile *does* record edges: pnpm's
snapshot bodies and yarn's descriptors name a target for every edge, so a
name that fails to compose is a real gap. npm and bun sections are
declarations — `name → range` — resolved positionally against the key
space, so "the walk found nothing" means "nothing installed", the
ordinary state of every unmet optional peer.[^npm-resolve-edges]

The exemption was measured before it was pinned. Across every npm and bun
fixture, each declared name the walk misses is a `peerDependencies` entry
nothing installed (an unmet optional peer of `vite`, `vitest` or
`react-redux`); not one sits in `dependencies`, `devDependencies` or
`optionalDependencies`. Reporting those as the pnpm/yarn resolvers would
was tried as a mutant: it raises `unresolvedEdges` on ordinary lockfiles
and turns the downstream peer check to `unverified: ["unresolvedEdge"]`
for a workspace with nothing wrong with it. A fail-closed signal that is
always on is one nobody reads.

## The mechanism

`resolveNpmEdges` and its bun twin return only `resolved`; they have no
unnameable set to fill, so the row's `unresolvedEdges` takes its `[]`
default.[^npm-resolve-edges]

The test "npm and bun: a declaration nothing installed is ABSENCE, not an
unresolved edge" walks `npm/peers`, `npm/v2`, `bun/peers` and `bun/v2`
asserting every row's `unresolvedEdges` is empty, proves non-vacuity by
checking `react-redux` declares a `redux` peer that resolves to nothing,
and then parses the pnpm `unnameablelink` fixture as the positive control
that the field is reachable at all.[^exemption-test]

## What would break it

Giving the npm or bun resolver an unnameable set, or dropping the control
half of the test so the assertions could pass on a field nothing ever
writes. A refactor that unifies the four resolvers must keep the npm and
bun paths declaration-only.

[^npm-resolve-edges]: `packages/lockfiles/src/internal/npm.ts` —
    `resolveNpmEdges`, whose doc comment states that an edge npm did not
    record is omitted rather than invented; `src/internal/bun.ts` mirrors
    it.
[^exemption-test]: `packages/lockfiles/__test__/Lockfile.test.ts` — "npm
    and bun: a declaration nothing installed is ABSENCE, not an unresolved
    edge", with the `pnpm/unnameablelink` positive control.
