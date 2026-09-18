---
"@effected/github-actions": patch
---

## Bug Fixes

### `CacheKey.matchingFiles` follows symlinked directories, matching the runner's `hashFiles()`

- The `descend` walk now runs with `followSymlinks: true`, so a file reachable only through a symlinked directory contributes to the cache key — `@actions/glob` (the runner's `hashFiles()`) follows links by default (`followSymbolicLinks: true`), and the previously documented knowing divergence silently produced a different key than the runner for such a workspace. `descend`'s real-path cycle guard keeps link loops finite.
