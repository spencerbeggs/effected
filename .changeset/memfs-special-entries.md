---
"@effected/memfs": minor
---

## Features

### Seed character devices, block devices, FIFOs and sockets

`MemoryFileSystem.special(type, { mode, mtime })` seeds a `"CharacterDevice"`, `"BlockDevice"`, `"FIFO"` or `"Socket"` entry, so a test can build a link such as `notes.md -> /dev/null` without faking `stat`.

* `stat` and `lstat` report the entry's `File.Type` with size `0`; directory listings and links resolve it like any other entry, and rename, remove, hard link, `chmod` and `utimes` work on it
* Every content operation (`open` with any flag, `readFile`, `writeFile` and append, `truncate`, `copyFile` from or onto it, `copy` of it) fails typed with errno `ENXIO`, the code Linux answers for opening a socket. Nothing is fabricated
* The sync and promises ports' stats and dirents gain `isCharacterDevice()`, `isBlockDevice()`, `isFIFO()` and `isSocket()`
* `NodeDirectorySeed.read` maps a FIFO, socket or device in a fixture to a special seed entry instead of throwing, without opening it

## Breaking Changes

* `MemoryFileSystemSeedEntry` gains `MemoryFileSystemSeedSpecial`, and `MemoryFileSystemVolumeStat.kind` gains `"special"`. An exhaustive `switch` over either stops compiling until it handles the new member
* `MemoryFileSystemPortStats` and `MemoryFileSystemDirent` gain four required predicates. Code that builds one by hand must add them
