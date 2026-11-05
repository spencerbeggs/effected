---
type: Module
title: "@effected/files"
description: Atomic single-file replacement over core FileSystem and Path in R, which writes a temp file beside the target, syncs it and renames it into place, so a crash never leaves a truncated user file, except through a link realPath cannot follow, which is written through directly.
status: draft
kind: package
resource: ../../packages/files
layer: boundary
tags:
  - architecture
generated:
  by: "okfit/claude-code"
  at: 2026-11-05T15:47:45Z
integrity:
  generated:
    body: e0d7154f8300c642
---

# `@effected/files`

`@effected/files` holds the one atomic single-file write the kit shares. A plain `writeFile` truncates its target first, so a crash during the write leaves the user with a short or empty file. `AtomicFile.write` leaves either the old content or the new content, whole. A link `realPath` cannot follow is the one exception: it is written through directly.

## Tier and dependencies

Boundary tier: it does IO through core `FileSystem` and `Path`, both in `R`. `effect` is the only peer and there are no dependencies, runtime or `@effected/*`. [`@effected/memfs`](memfs.md) is a devDependency for tests only. An adopter takes this package as a regular `workspace:^` dependency, because it carries no shared-instance contract.

## Public surface

```ts
AtomicFile.write(target: string, content: string | Uint8Array):
  Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path>
```

## Rulings

- **The error channel is plain `PlatformError`.** Each adopter keeps its existing `mapError`, so adopting this changes no public error type.
- **It does not create parent directories.** Adopters already do. An absent parent fails `NotFound`.
- **A failure never falls back to a non-atomic write.** A directory without write permission fails loudly.

## The choreography

1. Resolve the final path. `realPath(target)` if it answers. On `NotFound`, try `readLink(target)`. Success means a link `realPath` cannot follow, so `writeFile(target, bytes)` writes straight through it and the call ends: the filesystem resolves the link, so the data lands in the right place and the link survives. Any `readLink` failure means the target is simply absent, so `target` is used as given. Other `realPath` failures propagate, so a chain too long to follow fails with the filesystem's error.
2. Read the existing mode with `stat(final)`, masked `0o7777`. `NotFound` means no mode.
3. The temp is `.effected-<base36 random>.tmp` in the final path's directory. The name does not contain the target's basename, so a long name cannot overflow the name limit.
4. In a scope, open the temp with flag `wx` and the existing mode if there is one, write all the bytes, and sync. A string is encoded as UTF-8.
5. When a mode exists, `chmod` the temp, because the mode given to `open` is subject to umask.
6. Rename the temp over the final path.
7. Once `open` has succeeded, any failure or interruption in steps 4 to 6 removes the temp and keeps the original cause. A failed `open` removes nothing, so a name collision fails `AlreadyExists` and leaves the other writer's file alone. The open and the arming of this cleanup are one uninterruptible step, so an interrupt cannot leak the temp between them.

## Limits

- The directory needs write permission. A read-only directory fails.
- A hard link to the target is broken: the name gets a new inode and the other names keep the old content.
- The directory is not synced, so the rename itself may not survive power loss.
- A killed process can leave a `.effected-*.tmp` behind. Nothing sweeps it.
- A link `realPath` cannot follow (dangling, or with a symlink before `..` in its text under Node) is written through directly, without atomicity. Node's `realpath` applies link text lexically on POSIX, so it answers `NotFound` for the second shape even when the destination exists. That case has old content a crash can truncate.
- Windows can refuse the rename while a reader holds the file.

## Layout

One static class, `AtomicFile`, in `src/AtomicFile.ts`, re-exported from `src/index.ts`, following the [module-per-concept layout](../conventions/module-per-concept-layout.md). Whole-directory replacement is a different mechanism and stays in [`@effected/store`](store.md).
