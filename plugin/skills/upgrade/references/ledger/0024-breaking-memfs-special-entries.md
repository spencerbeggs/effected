---
id: "0024"
title: "@effected/memfs: seed devices, FIFOs and sockets with MemoryFileSystem.special; seed, volume-stat and port shapes widen"
kind: breaking
shows: typed
applies:
  "@effected/memfs": ">=0.28.0"
detect: ["MemoryFileSystemPortStats|MemoryFileSystemDirent|MemoryFileSystemVolumeStat", "isSymbolicLink: *\\(\\)", "type: *[\"'](CharacterDevice|BlockDevice|FIFO|Socket)[\"']"]
changesets: ["memfs-special-entries", "breaking-floor-effected-app"]
---

`MemoryFileSystem.special(type, { mode, mtime })` seeds a `"CharacterDevice"`, `"BlockDevice"`, `"FIFO"` or `"Socket"` entry. `stat`, `lstat`, directory listings, link resolution and the sync and promises ports report it by type with size `0`. Every content operation on it (`open`, `readFile`, `writeFile`, `truncate`, `copyFile`, `copy`) fails typed with errno `ENXIO`.

- **Break.** `MemoryFileSystemPortStats` and `MemoryFileSystemDirent` gain four required predicates: `isCharacterDevice()`, `isBlockDevice()`, `isFIFO()` and `isSocket()`. A hand-built stats or dirent object (a test double returning `{ isFile: () => …, isDirectory: () => …, isSymbolicLink: () => … }`) stops compiling; add the four, or seed the entry for real and drop the double.
- **Break.** `MemoryFileSystemSeedEntry` gains `MemoryFileSystemSeedSpecial`, and `MemoryFileSystemVolumeStat.kind` gains `"special"`. Handle the new member in any exhaustive `switch` over either.
- **Adopt.** Where a test fakes a device, FIFO or socket with a `stat` or `lstat` fault that rewrites `type`, seed it with `MemoryFileSystem.special` instead and remove the fault.
- **Behaviour.** `NodeDirectorySeed.read` now maps a FIFO, socket or device in a fixture directory to a special seed entry, never opening it, where it used to throw `ERR_SEED_UNSUPPORTED_TYPE`. A test that expected the throw for one of those types must expect the entry instead.

`@effected/app` raises its peer on `@effected/memfs` across that line, so it publishes as a minor too: upgrade it together with `memfs`. Check the installed `.d.ts` for the exact shapes.
