---
"@effected/memfs": patch
---

## Bug Fixes

* A `.` or `..` leaf on a directory now fails with node's errno where it failed `InvalidData` (#1327). `remove` fails `ERR_FS_EISDIR`, or `EINVAL` with `recursive`, and removes nothing. `rename` fails `EBUSY` on either side, which is Linux's errno. `symlink` and `link` fail `EEXIST`.
* The sync port's `realPath` now throws what the JS `realpathSync` throws (#1328). A component that is missing, or sits under a file, fails with `syscall: "lstat"`. A link that does not resolve fails with `syscall: "stat"`. In both cases `path` names the prefix it examined, and `realpath` never appears.
