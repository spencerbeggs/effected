---
type: Invariant
title: The npm and bun resolution walk is deepest-first
description: "@effected/lockfiles replays node resolution over the npm and bun key space from the depending package's own position outward to the root; an outermost-first order would return the hoisted copy and silently mis-report every shadowed dependency."
status: stable
resource: ../../packages/lockfiles/__test__/Lockfile.test.ts
tags:
  - testing
sources:
  - id: npm-walk
    resource: ../../packages/lockfiles/src/internal/npm.ts
  - id: bun-walk
    resource: ../../packages/lockfiles/src/internal/bun.ts
  - id: shadow-tests
    resource: ../../packages/lockfiles/__test__/Lockfile.test.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-22T01:21:07Z
integrity:
  generated:
    body: 317606648df48a48
---

# The npm and bun resolution walk is deepest-first

## The property

For a `package-lock.json` or `bun.lock` row, each declared dependency name
resolves to the **nearest** instance in the key space: the depending
package's own nested `node_modules` (npm) or `<parent-key>/<name>` (bun)
first, then each ancestor position, and the hoisted root last. A shadowed
copy always wins over the hoisted one, and a resolved edge only ever names
a key that exists in the lockfile.

## Why it must hold

Both formats encode install position in the key rather than recording an
explicit edge, so the walk *is* the resolution algorithm. Reversed, it
would return the hoisted copy for every shadowed dependency — `debug`
resolving to the root `ms@2.1.3` instead of its own `ms@2.0.0` — and the
error would be silent, because the hoisted copy is a real instance with a
plausible version. A consumer comparing peers or versions against such
rows would be told the wrong package satisfied the edge.

## The mechanism

`resolveNpmEdges` builds the prefix list from the entry's own directory
outward, stripping one path segment at a time to the root, and takes the
first hit.[^npm-walk] `resolveBunEdges` cannot split on `/` because scoped
names carry one, so it collects those prefixes of the key that are
themselves keys, sorts them longest-first and appends the root.[^bun-walk]

Three fixtures pin the order, each with a hoisted-versus-nested pair that
an outermost-first walk would answer wrongly: `npm/nested` (`ms` under
`debug`, plus a workspace-local `react@18` shadowing a hoisted `17`),
`bun/nested` (the same `ms` shadow), and the hand-authored
`npm/ancestor-walk`, whose intermediate-ancestor shape npm's own hoisting
avoids producing — a package at depth two resolving a name that lives at
depth one *and* at the root — so it cannot be regenerated on
demand.[^shadow-tests]

## What would break it

Iterating the prefix list root-first, computing bun's parent chain by
splitting on `/`, or replacing `npm/ancestor-walk` with generated output
(which would lose the only fixture that discriminates self-then-root from
a true ancestor walk).

[^npm-walk]: `packages/lockfiles/src/internal/npm.ts` — `resolveNpmEdges`,
    whose doc comment names deepest-first as "the whole algorithm".
[^bun-walk]: `packages/lockfiles/src/internal/bun.ts` — `resolveBunEdges`,
    prefixes read off the key space and sorted longest-first.
[^shadow-tests]: `packages/lockfiles/__test__/Lockfile.test.ts` —
    "resolves deepest-first, so a shadowed copy wins over the hoisted
    one", "resolves through an intermediate ancestor, not just
    self-then-root" and the bun "resolves deepest-first over the key
    space".
