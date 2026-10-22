---
"@effected/memfs": minor
---

## Features

### `lstat`

Every memory filesystem now implements `FileSystem.lstat`, which Effect 4.0.6 requires of a `FileSystem`. It reports a final symbolic link itself (`type: "SymbolicLink"`, a dangling link included) and still follows links earlier in the path, as Node's `lstat` does. `NodeSyncFileSystem` implements it with `lstatSync`, and a fault registered for `lstat` now fires.

## Bug Fixes

- An `EPERM` failure, such as hard-linking a directory, now reports `PermissionDenied` instead of `Unknown`, matching the Node adapter. Code that matched `Unknown` for these failures needs to match `PermissionDenied`.
