---
"@effected/memfs": patch
---

## Bug Fixes

* Recursive `makeDirectory` through a dangling or looping symlink component now fails with Node's errno instead of `EEXIST`: `ENOENT` or `ELOOP` for the final component, and `ENOTDIR` for a dangling intermediate component, matching `@effect/platform-node`'s async `mkdir`.
* `MemoryFileSystemHandle.mkdir` now matches `mkdirSync`, reporting `ENOENT` for a dangling intermediate component.
* Handle write and symlink parent-directory creation now reports Node's error when the parent path runs through a dangling symlink.
