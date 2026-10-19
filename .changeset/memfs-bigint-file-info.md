---
"@effected/memfs": minor
---

## Breaking Changes

### File metadata counts are `bigint`

`stat` now reports `dev`, `ino`, `rdev`, `nlink` and `blocks` as `bigint`, matching core's `FileSystem.File.Info`. `dev` is a `bigint`, and the others are `Option<bigint>`. `mode`, `uid` and `gid` stay `number`. Compare with bigint literals, such as `info.nlink.value === 2n`.

The `node-sync` adapter now reads these fields from Node as unsigned 64-bit values, the way core's Node adapter does. A device or inode number at or above 2^63 comes back exact. It no longer fails or drops.
