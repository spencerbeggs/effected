---
type: Gotcha
title: A yarn Berry lockfile has no devDependencies section
description: "Deprecated: @effected/lockfiles no longer parses yarn Berry lockfiles, so the resolver this gotcha described does not exist; a yarn repository still discovers its workspaces through package.json#workspaces."
status: deprecated
stale_after: 2027-03-21T00:00:00Z
tags:
  - dx
  - compat
generated:
  by: "okfit/claude-code"
  at: 2026-11-13T06:27:13Z
integrity:
  generated:
    body: c365f2cb577f63b3
---

# A yarn Berry lockfile has no devDependencies section

## What is actually true

This gotcha described the yarn resolver in `@effected/lockfiles`, which
iterated only a Berry entry's `dependencies` and `optionalDependencies`
because yarn folds a workspace's dev declarations into the one
`dependencies:` map. That resolver is gone: yarn is not a supported manager
([package-manager support policy](../conventions/package-manager-support-policy.md)),
and `@effected/lockfiles` parses bun, npm and pnpm lockfiles only.

A yarn repository still discovers its workspaces, from
`package.json#workspaces`; see
[workspace discovery](../interfaces/workspaces-discovery.md). Detection
reports it as an unsupported manager rather than guessing npm.
