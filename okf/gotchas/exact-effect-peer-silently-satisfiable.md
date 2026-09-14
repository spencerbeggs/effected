---
type: Gotcha
title: An unsatisfiable exact effect peer installs clean and fails somewhere else
description: "A consumer whose installed effect cannot satisfy an @effected/* package's exact peer range still installs without a resolution error under autoInstallPeers, and the mismatch then surfaces as a runtime SyntaxError naming an unrelated module."
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
  at: 2026-09-14T02:44:47Z
  body_sha256: afe0ea2064eb176bdae180a29fa31ba1ebf1e1b690bc1ff32cbe46baef6d1a86
---

# An unsatisfiable exact effect peer installs clean and fails somewhere else

## What a reader sees

`pnpm install` (or `pnpm add`) completes with no error in a consumer
repository still on `effect@3.x`, or on an older v4 prerelease, after
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

Every published `@effected/*` package advertises the exact catalog pin as
its `effect` peer range (`"effect": "4.0.0-rc.115"`, no
caret).[^pnpm-workspace] Under pnpm's common `autoInstallPeers: true`
default, an **exact** peer that cannot be satisfied is glued into the
tree anyway, with no resolution error at install time. The mismatch
between the installed `effect` and what the `@effected/*` package
actually needs only surfaces later, at runtime, as a missing export from
whichever module happens to reach for something the installed `effect`
does not have — which is very unlikely to be the package that was just
installed. A v4-only named export (`FileSystem`, `Result`, `Schema`
moved into core) missing from a v3 `effect` is this bug, not a rename to
chase in the erroring module.

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
    under the `lock` strategy holds the same exact pin as `effect`,
    which every published `@effected/*` package's `peerDependencies`
    resolves from.
