---
type: Limitation
title: memfs's volume is invisible to anything that does not ask for the FileSystem service
description: memfs installs no hooks and patches no module registry, so direct node:fs calls, spawned processes, native-binding IO, process.cwd() and process.platform all silently bypass the volume.
status: stable
bounds: ../modules/memfs.md
tags:
  - testing
sources:
  - id: memfs-claude-md
    resource: ../../packages/memfs/CLAUDE.md
  - id: memfs-readme
    resource: ../../packages/memfs/README.md
  - id: xdg-readme
    resource: ../../packages/xdg/README.md
generated:
  by: "okfit/claude-code"
  at: 2026-09-30T01:39:09Z
  body_sha256: df9deeaa159f483d07e90ac192c16ec5af98481229275f573ff8d583e426884b
---

# memfs's volume is invisible to anything that does not ask for the FileSystem service

## Condition

`@effected/memfs` implements exactly one thing — core's `FileSystem`
service. It installs no hooks, patches no module registry and
intercepts nothing globally. The volume is visible only to code that
*asks for the service* through `R`, and invisible to everything else in
the same process.

## Symptom

Five call shapes silently bypass the volume rather than erroring or
warning:

1. **A direct `node:fs` call** reads and writes the real host filesystem
   in the same process, ignoring whatever the volume holds.
2. **A spawned child process** inherits the host filesystem, not the
   volume — a command seam that touches files must be tested with a
   `ChildProcessSpawner` double instead, since memfs has nothing to do
   with subprocess IO.
3. **Native-binding IO** — `@effect/sql-sqlite-node` is the usual
   case — never reaches the `FileSystem` service at all, so an in-memory
   database is the right double there, not memfs.
4. **`process.cwd()`** is not modeled by the volume. Code that consults
   it internally silently leaves the volume's model behind, and nothing
   fails loudly to flag the mismatch.
5. **`process.platform`** is not virtualized either: memfs virtualizes
   the filesystem, not the platform. Code that branches on it — such as
   `@effected/xdg`'s `AppDirs`/`XdgConfig`, through the `CurrentPlatform`
   `Context.Reference`, which defaults to `process.platform` — still takes
   the host's branch over a memfs volume. Pin it with
   `Effect.provideService(CurrentPlatform, "linux")` or
   `Layer.succeed(CurrentPlatform, ...)`, as the Testing section of
   [`@effected/xdg`'s README](../../packages/xdg/README.md) shows.

## Why this is acceptable

Closing any of the five would mean either patching global module
resolution (turning memfs into the kind of ambient-hook test double the
package was built specifically to avoid, since ambient patching is
exactly the deny-by-default surprise class `layerNoop` already produces
in a different form) or building an adapter that lets code bypass the
service injection discipline entirely — which the package's own
[`fs.promises` facade](../modules/memfs.md#provenance-and-refusals)
already declined once, for a related reason: a bypass-shaped facade
legitimizes call sites that never inject `FileSystem` at all, growing a
second, weaker sanctioned path alongside the real one. No adapter is
offered to close any of the five, for the same reason.

## Case folding has limits

`caseSensitive: false` is not a full model of a case-insensitive host.
Folding is `toLowerCase` only, per UTF-16 unit, so `İ` (U+0130) and
`ß`/`ẞ` do not fold as a regex `i` flag would; there is no NFC/NFD
normalization, so two names APFS treats as one stay distinct in memfs;
and glob folding is per UTF-16 unit too. A green case-insensitive test
over such names is not evidence about the host.

## The check

Confirm any test exercising one of the call shapes above does not use
memfs as its double — a `ChildProcessSpawner` fault-injection double for
subprocess IO, an in-memory database driver for native-binding IO, and a
real tmpdir (or an explicit `process.cwd()`-aware fixture) for anything
that consults the working directory. A green test asserting on volume
state after a code path that spawns, calls `node:fs` directly, or reads
`process.cwd()` is not evidence the code path is correct — it is
evidence the assertion never reached the real IO.

`packages/memfs/README.md` states the invisibility cases for consumers
directly.[^memfs-readme]

[^memfs-readme]: `packages/memfs/README.md:293-301` — the
    invisibility cases stated for consumers.
