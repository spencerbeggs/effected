---
"@effected/walker": minor
---

## Features

### `descend` accepts `followSymlinks` to enter symlinked directories under a real-path cycle guard

- `DescendOptions.followSymlinks` (default `false`, preserving today's never-descend behaviour) makes `descend` enter symlinked directories. The cycle guard stays underneath the switch: every link descent records the target's real path (`FileSystem.realPath`) and a link resolving to an already-visited real path — the walk base, an ancestor, or an earlier link's target — is skipped, so link loops terminate. This is Node's `fs.promises.readdir(path, { recursive: true })` behaviour and `@actions/glob`'s default `followSymbolicLinks: true`, so a file reachable only through a symlinked directory is no longer silently absent from the answer.
