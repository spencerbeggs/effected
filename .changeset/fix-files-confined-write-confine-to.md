---
"@effected/files": minor
---

## Features

`AtomicFile.write` takes a `confineTo` option: a root directory the write must stay inside (#1452).

- The target must lie strictly below the root. A `..` escape, an absolute path outside the root, a sibling that shares the root's name prefix and the root itself are all refused.
- Every directory from the root down to the target's directory must be a real directory, not a symbolic link. The directory's real path must match the planned path under the root's real path.
- A symbolic link at the target is refused, unless `links: "replace"`, which replaces the link entry. `links: "follow"` combined with `confineTo` is a defect.
- The temp file is written in the target's real directory. The same checks run again after the temp is written, both before the `chmod` that restores the mode and immediately before the rename.
- A refusal is a `PlatformError` whose `SystemError` is tagged `PermissionDenied`, with `module: "AtomicFile"`. The error channel does not change.

Some exposure remains, and the TSDoc says so. Core `FileSystem` has no directory handles, so a link swapped in between the last check and the `rename` call can still redirect the rename. If a check fails, the temp file is left in place rather than removed through a path that may now cross the link.
