---
type: Gotcha
title: A yarn Berry lockfile has no devDependencies section
description: "The yarn resolver in @effected/lockfiles iterates only dependencies and optionalDependencies, which looks like dropped dev edges; yarn folds a workspace's dev declarations into the entry's dependencies map, so the edges are already resolved and iterating devDependencies is dead code."
status: stable
resource: ../../packages/lockfiles/src/internal/yarn.ts
stale_after: 2027-03-21T00:00:00Z
tags:
  - dx
  - compat
sources:
  - id: yarn-resolver
    resource: ../../packages/lockfiles/src/internal/yarn.ts
  - id: devdeps-test
    resource: ../../packages/lockfiles/__test__/Lockfile.test.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-22T01:21:07Z
integrity:
  generated:
    body: d270cf0dc6bd0811
---

# A yarn Berry lockfile has no devDependencies section

## What you see

`resolveYarnEdges` walks `entry.dependencies` and
`entry.optionalDependencies` and never touches `entry.devDependencies`,
even though the raw yarn entry schema declares that field and the other
three formats' resolvers iterate a dev section.[^yarn-resolver]

## What you will conclude

That a workspace's dev edges are silently dropped for yarn, and that
adding `entry.devDependencies` to the loop is a one-line fix.

## What is actually true

A Berry lockfile records no `devDependencies` section. yarn folds a
workspace's dev declarations into the entry's single `dependencies:` map,
and the file it writes is byte-identical whether a dependency was declared
under `dependencies` or `devDependencies` in `package.json` (probed against
yarn 4.9.1). Dev edges are therefore already resolved by the existing
loop; iterating `entry.devDependencies` changes no test in this package or
in `workspaces`. The schema keeps the field only as permissive scaffolding
for hand-edited input.

The `yarn/devdeps` fixture pins this: `typescript` is declared only in
`devDependencies` and `chalk` only in `dependencies`, and both resolve on
the root and `lib` workspace rows. The pair is what makes the test
discriminating — a resolver that visited only some declared section would
show one edge and not the other.[^devdeps-test]

This is separate from the peer gap: yarn *does* omit resolved peer edges,
for the reason in
[yarn carries no resolved peer edges](../limitations/lockfiles-yarn-carries-no-peer-edges.md).

[^yarn-resolver]: `packages/lockfiles/src/internal/yarn.ts` —
    `resolveYarnEdges` and its doc comment on the missing section.
[^devdeps-test]: `packages/lockfiles/__test__/Lockfile.test.ts` — "resolves
    a workspace's DEV edges — yarn records them as dependencies", over
    `__test__/fixtures/yarn/devdeps`.
