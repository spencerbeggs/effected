---
type: Gotcha
title: An unsatisfiable effect peer installs clean and fails somewhere else
description: "A consumer whose installed effect cannot satisfy an @effected/* package's effect peer range, exact or caret, still installs without a resolution error under autoInstallPeers, and the mismatch then surfaces as a runtime SyntaxError naming an unrelated module."
status: stable
resource: ../../pnpm-workspace.yaml
stale_after: 2027-03-13T00:00:00Z
tags:
  - compat
  - dx
sources:
  - id: pnpm-workspace
    resource: ../../pnpm-workspace.yaml
generated:
  by: "okfit/claude-code"
  at: 2026-10-01T17:24:58Z
  body_sha256: 881a0ad7825c127dbf6b42e69e8c0ac8222331612a9deb9a9a59aa8321fd95db
---

# An unsatisfiable effect peer installs clean and fails somewhere else

## What a reader sees

`pnpm install` (or `pnpm add`) completes with no error in a consumer
repository still on `effect@3.x`, or on a v4 release candidate, after
adding an `@effected/*` package. Some time later — often from a
completely different module than the one just installed — the process
throws:

```text
SyntaxError: The requested module 'effect' does not provide an export named 'FileSystem'
```

Nothing in that error names the peer dependency that caused it.

## What they wrongly conclude

That this is an Effect API problem in whichever module the stack trace
names — a rename, a removed export, or a bug in that module's own
import — and that the fix is there.

## What is actually true

Every published `@effected/*` package advertises an `effect` peer range
taken from the `effect:peers` catalog: the caret `^4.0.0` on the stable
line, and the exact release-candidate version it was built against on
earlier releases (`"effect": "4.0.0-rc.115"`).[^pnpm-workspace] The shape
of the range does not matter to the trap. Under pnpm's common
`autoInstallPeers: true` default, a peer that the installed `effect`
cannot satisfy, whether exact or caret, is glued into the tree anyway,
with no resolution error at install time: pnpm prints a peer-dependency
warning and binds the package to the consumer's own copy. The mismatch
between the installed `effect` and what the `@effected/*` package
actually needs only surfaces later, at runtime, as a missing export from
whichever module happens to reach for something the installed `effect`
does not have — which is very unlikely to be the package that was just
installed. A v4-only named export (`FileSystem`, `Result`, `Schema`
moved into core) missing from a v3 `effect` is this bug, not a rename to
chase in the erroring module.

A probe on 2026-10-01, with pnpm 12.6.0, confirmed it for the caret. A
package declaring `peerDependencies: { effect: "^4.0.0" }` was installed by
a consumer whose direct dependency was `effect@3.10.0`. The install
exited 0, printed only `Issues with peer dependencies found`, and
resolved the package as `file:../lib(effect@3.10.0)`: the unsatisfiable
caret was bound to the v3 copy. A v4 caret therefore narrows who is
satisfied but does not turn the mismatch into an install error. What a
caret changes is how often it happens: a consumer on any `4.x` is now
satisfied, so the trap is left to consumers on v3 or on a release
candidate.

This route commonly arrives through a *third-party* package that takes
an `@effected/*` package as a peer rather than a dependency — which
pushes the resolution decision onto a consumer that has no idea it is
making one.

## The check

Before reading a missing-export `SyntaxError` as an Effect API problem in
the module the stack trace names, check the installed `effect` version
against the `effect` peer range the `@effected/*` package actually
declares. A mismatch there is the bug; the erroring module is just where
it happened to surface.

[^pnpm-workspace]: `pnpm-workspace.yaml` — the `effect:peers` catalog
    holds the range, `^4.0.0` under `lock-minor`, that every published
    `@effected/*` package's `peerDependencies` resolves from.
