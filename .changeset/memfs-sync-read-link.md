---
"@effected/memfs": minor
---

## Features

* `MemoryFileSystem.syncFileSystem` gains `readLink`, with `readlinkSync`'s contract: the final link's stored target, parent links resolved, and node's exact `EINVAL` for a non-link and `ENOENT`, `ENOTDIR` or `ELOOP` for an unreachable path; a memfs handle now gives `@effected/walker`'s sync walk full link reporting
