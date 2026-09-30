---
"@effected/memfs": minor
---

## Breaking Changes

The constructor family collapsed onto one options bag, `{ root, caseSensitive, faults }`. Every memory layer now also provides `MemoryFileSystem.Volume`, and the seed is optional. This is a `0.x` minor with deliberate DX breaks; every "before" below is the published `0.12.0`.

| Before (`0.12.0`) | After |
| :---------------- | :---- |
| `layerFaultyWith(seed, faults)` | `layerWith(seed, { faults })` |
| `layerInspectable` | `layer` (it now provides `Volume` too) |
| `layerInspectableWith(seed)` | `layerWith(seed)` |
| `makeInspectable` (a value) | `makeHandle()` |
| `makeInspectableWith(seed)` | `makeHandle(seed)`; `{ fileSystem, volume }` destructuring is unchanged |
| type `MemoryFileSystemInspectable` | type `MemoryFileSystemHandle` |
| `layer` / `layerWith` typed `Layer<FileSystem>` | typed `Layer<FileSystem \| MemoryFileSystemVolume>`; still assignable to `Layer<FileSystem>` |
| an unknown fault key was silently ignored | throws `RangeError` naming the key at construction (a layer build dies) |
| `makeFaulty` / `layerFaulty` accepted a base whose methods live on its prototype | fault keys must be own enumerable function members of the base, so a class-instance base throws; wrap it in `FileSystem.make({ ... })` first |
| sync-port errors read `ENOENT: readFile '/x'`, with syscall `readFile` or `readDirectory` | node's exact message (`ENOENT: no such file or directory, open '/x'`) and syscall (`open`, `read`, `scandir`); update any matcher on `message` or `syscall` |
| reading a directory through the sync port threw `EISDIR: readFile '<path>'` with `path` set | `EISDIR: illegal operation on a directory, read`, with no `path`, byte-identical to node |
| a sync-port path through a regular file failed `ENOENT` (`/file/child`) or resolved as if the file were a directory (`/file/..`, `/file/`) | fails `ENOTDIR`, as node does; `exists` is `false` |
| a symbolic-link cycle through the sync port failed `ENOENT` | fails `ELOOP` (`exists` stays `false`) |
| `MemoryFileSystemSyncFileSystem` had four members | it also requires `stat` and `lstat`; a hand-implemented object no longer typechecks |
| `MemoryFileSystemVolume` had no `lstat` | it requires `lstat`; a hand-implemented object no longer typechecks |

```ts
// before
MemoryFileSystem.layerFaultyWith(seed, faults);
// after
MemoryFileSystem.layerWith(seed, { faults });
```

## Features

### Options bag and handles

`makeSync` and `makeHandle` return a handle carrying the filesystem, the volume, the sync and promises ports, and a ready-made layer. Its `write`, `mkdir`, `remove` and `symlink` mutators resolve relative paths against `options.root`, `handle.root` exposes it, and `handle.withFaults` returns faulted ports over the same volume. `root` is a join base: relative seed keys, including `..` keys, join it.

### Case-insensitive, case-preserving volumes

`caseSensitive: false` models a case-insensitive, case-preserving filesystem, checked against APFS on a real host. Closes #874.

### Sync and promises ports

* `syncFileSystem` gains `stat`, `lstat` and faults, and there is a new `promisesFileSystem` port
* `volume.lstat` inspects a path without following links
* `MemoryFileSystem.errno` builds node-shaped errno errors
* Port errors carry node-exact messages and syscalls

### `@effected/memfs/node-sync`

New subpath exporting `NodeSyncFileSystem`, a read-only synchronous Node `FileSystem` for running an Effect program under `Effect.runSync` from a synchronous host API, such as a bundler config. Its read members match `@effect/platform-node` value for value and failure for failure; every other member is a defect. Closes #532.

Closes #887, #874, #532.
