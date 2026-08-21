---
"@effected/workspaces": minor
---

## Features

### Faster package enumeration via an optional fast path

`SyncFileSystem` gains an optional member, `readDirectoryWithTypes?: (path) => ReadonlyArray<SyncDirectoryEntry>`, and a new exported type `SyncDirectoryEntry` (`{ name, isDirectory, isSymbolicLink }`). It's optional, so every existing `SyncFileSystem` implementation keeps satisfying the type untouched.

`nodeFileSystem` implements it via `readdirSync(path, { withFileTypes: true })`. Previously, enumerating a directory's packages cost a `readDirectory` call plus one `isDirectory` (`statSync`) call per entry; supplying the fast path collapses that to a single syscall. Omitting it falls back to the original four-operation path with identical results — this is purely a cost optimization, never a behavior change.

A subtlety worth knowing: a `Dirent` describes the entry itself, not its target, so a symbolic link pointing at a directory reports `isDirectory: false` even though the slower `stat`-based path calls it a directory. Enumeration re-resolves links through `isDirectory` and only trusts the fast path's `isDirectory` for non-links, so a symlinked package directory is never silently dropped.
