---
"@effected/github-actions": minor
---

## Performance

### `ToolInstaller.cacheDir` renames the toolchain into the cache

`cacheDir` now moves its source directory into the tool cache with a rename instead of a recursive copy. On hosted runners `RUNNER_TEMP` and `RUNNER_TOOL_CACHE` share a filesystem, so installing an extracted toolchain is O(1) regardless of its size. A cross-filesystem source (`EXDEV`) falls back to the previous copy; any other rename failure is still reported as `cacheFailed` rather than masked by a copy.

**Behaviour change:** `cacheDir` now **consumes** `source` — after a successful call the directory no longer exists at its original path (moved, or copied and then removed). Write everything the cached entry must contain into the source before calling `cacheDir`, and read nothing from it afterwards. `PackageManagerInstaller` already followed that ordering; `cacheFile` is unchanged and still copies.
