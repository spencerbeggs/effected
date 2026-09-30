---
"@effected/memfs": minor
---

## Breaking Changes

The constructor family collapsed onto one options bag, `{ root, caseSensitive, faults }`. Every memory layer now also provides `MemoryFileSystem.Volume`, and the seed is optional. This is a `0.x` minor with deliberate DX breaks.

| Before | After |
| :----- | :---- |
| `layerFaultyWith(seed, faults, options?)` | `layerWith(seed, { ...options, faults })` |
| `layerInspectable` | `layer` (it now provides `Volume` too) |
| `layerInspectableWith(seed, options?)` | `layerWith(seed, options)` |
| `makeInspectable` (a value) | `makeHandle()` |
| `makeInspectableWith(seed, options?)` | `makeHandle(seed, options)`; `{ fileSystem, volume }` destructuring is unchanged |
| type `MemoryFileSystemInspectable` | type `MemoryFileSystemHandle` |
| `promises.readFile(path)` resolved a `string` | resolves a `Uint8Array`, as node does; pass `"utf8"` or `{ encoding: "utf8" }` for a string |
| an unknown fault key was silently ignored | throws `RangeError` naming the key, at construction (or dies at layer build) |
| `makeSync` seed failures reported the Effect method as `syscall` (`makeDirectory`) | report node's syscall (`mkdir`, `open`, `symlink`, `chmod`, `utime`); update any matcher |
| `MemoryFileSystemErrnoError.path: string` | `path?: string`; a descriptor syscall such as `read` carries no path, as in node |
| a read-as-directory error read `EISDIR: …, read '<path>'` | `EISDIR: illegal operation on a directory, read` with no `path`, byte-identical to node |
| a throwing promises-port fault handler threw at the call site | it rejects |

`layer` and `layerWith` are now typed `Layer<FileSystem | MemoryFileSystemVolume>`; they remain assignable to `Layer<FileSystem>`.

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

## Bug Fixes

* Sync-port errors report the correct syscalls (`open`, `scandir`)
* Symlink cycles fail with `ELOOP`, and a dangling or looping parent link fails a handle write
* Paths through a regular file fail with `ENOTDIR`

Closes #887, #874, #532.
