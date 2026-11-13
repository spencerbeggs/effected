---
type: Limitation
title: Yarn carries no resolved peer edges
description: "Deprecated: @effected/lockfiles no longer parses yarn Berry lockfiles, so there is no yarn row to carry a resolved peer edge."
status: deprecated
bounds: ../modules/lockfiles.md
tags:
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-11-13T06:27:13Z
integrity:
  generated:
    body: 861f2e5d466cda1b
---

# Yarn carries no resolved peer edges

## Condition

This limitation bounded the yarn Berry parser in `@effected/lockfiles`:
yarn resolves peer dependencies virtually and `yarn.lock` records no join
between a peer declaration and the instance that satisfied it, so the parser
never populated a resolved peer edge.

## Current state

The parser is removed. `@effected/lockfiles` reads bun, npm and pnpm
lockfiles, and a yarn repository is refused at package-manager detection
([support policy](../conventions/package-manager-support-policy.md)). Nothing
in the package answers a yarn lockfile, so no consumer meets this gap there.
