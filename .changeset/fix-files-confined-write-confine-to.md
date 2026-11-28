---
"@effected/files": minor
---

## Features

`AtomicFile.write` takes a `confineTo` option: a root directory the write must stay inside (#1452).

- The target must lie strictly below the root. A `..` escape, an absolute path outside the root, a sibling that shares the root's name prefix and the root itself are all refused.
- Every directory from the root down to the target's directory must be a real directory, not a symbolic link. The directory's real path must match the planned path under the root's real path.
- A symbolic link at the target is refused, unless `links: "replace"`, which replaces the link entry. `links: "follow"` combined with `confineTo` is a defect.
- The temp file is written in the target's real directory. The same checks run again immediately before the temp is opened, before the `chmod` that restores the mode, and immediately before the rename.
- A refusal is a `PlatformError` whose `SystemError` is tagged `PermissionDenied`, with `module: "AtomicFile"`. The error channel does not change.

Some exposure remains, and the TSDoc says so. Core `FileSystem` has no directory handles, so each path call resolves its parents afresh:

- A parent swapped for a link between the last check and the temp's open makes the open create the temp, with the content, at the link's destination outside the root. The next check refuses and removes that temp.
- A link swapped in between the last check and the `rename` call can still redirect the rename.
- A parent moved aside after the temp is opened leaves the temp in the moved directory, still inside the root.
