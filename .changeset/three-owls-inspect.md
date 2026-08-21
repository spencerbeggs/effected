---
"@effected/memfs": minor
---

## Features

### Sync inspection of directories and modification times

`MemoryFileSystemVolume` gains three members for inspecting a seeded volume without going through the `FileSystem` service:

- `readDirectory(path)` — the entry names directly inside a directory, or `undefined` when nothing is there
- `isDirectory(path)` — whether `path` holds a directory
- `mtime(path)` — the entry's modification time as epoch milliseconds, or `undefined` when nothing is there

All three are literal: a symbolic link is never followed, even one pointing at a directory. Absence is always `undefined`, never a fabricated `[]` or `0` — those are legitimate answers (an empty directory, the epoch) that must not be confused with "nothing here."

### A synchronous `node:fs`-shaped adapter

`MemoryFileSystem.syncFileSystem(volume)` adapts a volume to the `node:fs` synchronous subset (`exists`, `readFile`, `readDirectory`, `isDirectory`) for code that takes an *injected* sync filesystem port instead of requiring `FileSystem` from the environment:

```ts
const volume = yield* MemoryFileSystem.Volume;
const sync = MemoryFileSystem.syncFileSystem(volume);
sync.readDirectory("/repo"); // => ["package.json", "packages"]
```

Because the shape is satisfied structurally, this adapter works anywhere the same four operations are expected — including `@effected/workspaces`'s `SyncFileSystem` — with no import in either direction. Unlike the inspection view, absence here throws (carrying `code`, `syscall` and `path`), since a synchronous signature has no other failure channel. This is not a general escape hatch: code that calls `node:fs` directly still doesn't see the volume.

### Seeding a modification time

`MemoryFileSystem.file(content, { mode, mtime })` now accepts an `mtime` option (epoch milliseconds) to give a seeded entry an explicit modification time, for tests that need one file to read as older than another.

Two behaviors are easy to trip on:

- `FileSystem.utimes` reads a bare number as Unix **seconds** (matching `fs.utimesSync`), while the seed option is milliseconds — seeding converts through a `Date` internally.
- The volume stamps writes from the Effect `Clock`, so every write under `it.effect` reads as mtime `0` until the clock is advanced with `TestClock`.

## Bug Fixes

- `MemoryFileSystemVolume.has("/")` incorrectly answered `false` for the volume root, which always exists. `has`, `isDirectory`, `readDirectory` and `mtime` now all agree on `/`.
