---
type: Gotcha
title: An unsatisfiable effect peer installs clean and fails somewhere else
description: "A consumer whose installed effect cannot satisfy an @effected/* package's effect peer, an exact version on every release built under the exact lock, still installs without a resolution error under autoInstallPeers; the mismatch surfaces later at runtime, in a module unrelated to the one just installed."
status: stable
resource: ../../pnpm-workspace.yaml
stale_after: 2027-03-13T00:00:00Z
tags:
  - compat
  - dx
sources:
  - id: pnpm-workspace
    resource: ../../pnpm-workspace.yaml
  - id: exact-lock
    resource: ../decisions/effect-catalog-locked-exact.md
    title: "The effect catalog locks every entry to an exact version, held by overrides"
generated:
  by: "okfit/claude-code"
  at: 2026-10-10T23:08:17Z
  body_sha256: c88bb1d92aa10970787423364b4103d4e35bcc03e9edca2e62b0b96400479968
---

# An unsatisfiable effect peer installs clean and fails somewhere else

## What a reader sees

`pnpm install` (or `pnpm add`) completes with no error in a consumer
repository whose `effect` differs from the one an `@effected/*` package
was built against — `effect@3.x`, a v4 release candidate, or, now that
the kit publishes exact peers, any other `4.x` — after adding that
package. Some time later — often from a
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

Every published `@effected/*` package advertises an `effect` peer taken
from the `effect:peers` catalog.[^pnpm-workspace] On every release built
under [the exact lock](../decisions/effect-catalog-locked-exact.md), that
peer is the exact version the package was built against,
`4.0.2`.[^exact-lock]
Releases published before it on the stable line advertise the caret
`^4.0.0`, and release-candidate releases advertise their candidate's exact
version (`"effect": "4.0.0-rc.115"`).

The shape of the peer does not change the trap. Under pnpm's common
`autoInstallPeers: true` default, a peer the installed `effect` cannot
satisfy is glued into the tree anyway, with no resolution error at install
time. pnpm prints a peer-dependency warning and binds the package to the
consumer's own copy. The mismatch surfaces later, at runtime, in whichever
module reaches for something the installed `effect` does not have, which
is very unlikely to be the package just installed. A v4-only named export
(`FileSystem`, `Result`, `Schema` moved into core) missing from a v3
`effect` is this bug, not a rename to chase in the erroring module.

A probe on 2026-10-01, with pnpm 12.6.0, confirmed it for the caret. A
package declaring `peerDependencies: { effect: "^4.0.0" }` was installed by
a consumer whose direct dependency was `effect@3.10.0`. The install
exited 0, printed only `Issues with peer dependencies found`, and
resolved the package as `file:../lib(effect@3.10.0)`: the unsatisfiable
caret was bound to the v3 copy.

What the exact peer changes is who hits it. Under the caret, any `4.x`
satisfied the peer, so the trap was left to consumers on v3 or a release
candidate. Under the exact peer, a consumer on any other `4.x` (`4.0.1`, or
`4.0.3` once it ships) is unsatisfied too, gets the same warning, and is
bound to its own copy. Whether that then fails at runtime depends on
whether the consumer's `effect` lacks something the package uses. The warning
alone does not say, so it cannot be dismissed as noise. A consumer that
installs `@effected/pnpm-plugin-effect` avoids the mismatch: its catalog
and its HOLD overrides resolve `effect` and every satellite to the version
the kit peers on.

A satellite resolved against a core it was not built for is a related
failure with a different signal: a missing `effect/dist/...` file at
import, not a missing named export. See
[the 2026-10-10 incident](../incidents/effect-satellites-published-without-core.md).

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
    holds the exact version, under `lock`, that every published
    `@effected/*` package's `peerDependencies` resolves from.
[^exact-lock]: `okf/decisions/effect-catalog-locked-exact.md`
