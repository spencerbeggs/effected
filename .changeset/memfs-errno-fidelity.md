---
"@effected/memfs": minor
---

## Bug Fixes

### Paths through a file or a symlinked directory fail as node does

* `remove`, `rename`, `symlink` and `link` fail `ENOTDIR` or `ENOENT` where they failed `InvalidData`
* The ports fail `ENOTDIR` on `file/.` instead of answering the file
* `realPath` folds `.` and `..` lexically first, as `fs.realpath` does

A caller that matched on `InvalidData` for these cases matches the `PlatformError` reason for the errno instead.
