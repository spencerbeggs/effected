---
type: Decision
title: xdg stays independent of core UserDirectories
description: "@effected/xdg does not wrap or defer to effect/persistence's unstable UserDirectories, because core folds the XDG variable and the native directory into one answer per kind; instead xdg ports the two edge rules core gets right (ignore relative values, USERPROFILE on win32) and pins the agreed subset with a parity oracle."
status: draft
tags:
  - architecture
sources:
  - id: core-user-directories
    resource: ../../.repos/effect/packages/effect/src/persistence/UserDirectories.ts
  - id: xdg-source
    resource: ../../packages/xdg/src/Xdg.ts
  - id: xdg-appdirs
    resource: ../../packages/xdg/src/AppDirs.ts
  - id: xdg-parity-test
    resource: ../../packages/xdg/__test__/CoreParity.test.ts
  - id: ticket-1041
    resource: https://github.com/spencerbeggs/effected/issues/1041
generated:
  by: "okfit/claude-code"
  at: 2026-10-23T20:32:35Z
integrity:
  generated:
    body: 94b0d0cf18824d62
---

# xdg stays independent of core UserDirectories

## Context

Effect added a `UserDirectories` service to `effect/persistence`, marked
`@stability unstable`, with `home` and one `config`/`data`/`cache`/`state`
directory per application name, read through `Config` and resolved lazily on
every call.[^core-user-directories] It overlaps `@effected/xdg`, and the
question was whether xdg should build on it, defer to it, or stay
independent.[^ticket-1041] A parity probe found that the two agree on absolute
`XDG_*_HOME` values and on the macOS and Windows native directories, and that
core was right on two edges where xdg was wrong: core ignores a relative XDG
value (xdg resolved it against the working directory), and core reads the
Windows home directory from `USERPROFILE` (xdg read only `HOME`, which a
typical Windows shell does not set).

## Decision

xdg stays independent. It does not import `UserDirectories`, and no kit
package wraps it. xdg ports the two edge rules instead:[^xdg-source]

- a relative `XDG_*` value, or a relative `*_DIRS` entry, is ignored as the
  XDG Base Directory specification requires — `XDG_*` judged by the
  platform's absolute rule, `APPDATA`/`LOCALAPPDATA` always by the Windows
  rule, and an emptied `*_DIRS` list taking the spec default;
- on win32 the home directory is `USERPROFILE`, then `HOME`, and the `*_DIRS`
  lists split on `;`.

The agreed subset is pinned by a differential test against core, marked as
tracking an unstable module, so a change on either side is noticed.[^xdg-parity-test]

Where the two deliberately differ, xdg keeps its own behaviour: the Linux
default stays `~/.<namespace>` rather than the spec's per-kind layout, because
downstream applications already keep their data there; and a missing home
directory still fails `Xdg.layer` eagerly, because the fallback rungs, the
native rung and the runtime directory all derive from it.

## Alternatives rejected

**Rebuild `AppDirs` on `UserDirectories`.** Core returns one merged answer per
kind and does not say whether it came from the XDG variable or the native
directory, so xdg's precedence ladder — override, XDG, native when opted in,
`fallbackDir`, `~/.<namespace>` — cannot be layered over it.[^xdg-appdirs] Core
also re-reads the environment per call with a `PlatformError` channel, which
would break the resolve-once, infallible `dirs` contract that
`XdgConfig.savePath`'s `never` channel depends on.

**Deprecate xdg in favour of core.** That would strand the `*_DIRS` search
paths, the runtime directory and the config-file resolver chain, none of which
core has, and pin the kit to a module core may change in a minor release.

## Consequences

The Windows and relative-value fixes are behaviour changes with no type
change: a relative value now falls to the next rung, and a Windows shell
without `HOME` now resolves. `CurrentPlatform` gains a third reader
(`Xdg.layer`, beside `AppDirs.layer` and `XdgConfig.nativeResolver`), so an
application that overrides it provides it once, at the edge. Revisit this
decision only if core grows search paths or exposes the per-rung inputs.

[^core-user-directories]: `.repos/effect/packages/effect/src/persistence/UserDirectories.ts`
    — the service interface, `make`, `isAbsolute` and the `USERPROFILE` home
    variable.
[^ticket-1041]: issue 1041 — review `@effected/xdg` against core
    `UserDirectories`.
[^xdg-source]: `packages/xdg/src/Xdg.ts` — `Xdg.layer`, `isAbsoluteFor` and
    `splitDirs`.
[^xdg-appdirs]: `packages/xdg/src/AppDirs.ts` — `resolveDir`, the five-rung
    ladder.
[^xdg-parity-test]: `packages/xdg/__test__/CoreParity.test.ts` — the parity
    oracle.
