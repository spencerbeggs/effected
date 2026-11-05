---
"@effected/memfs": minor
---

## Bug Fixes

* `NodeSyncFileSystem.layerWithPath` (#1173) now provides the host's own `Path` rather than core's POSIX-only one, so a program using both services reads Windows paths correctly beside the real filesystem. This is not yet exercised on Windows.
