---
"@effected/files": minor
---

## Features

### `@effected/files`

A new package for crash-safe writes over core `FileSystem` and `Path`, both required in `R` (#1234, #1183).

* `AtomicFile.write(target, content)` replaces a file through a synced temp file in the target's directory and a rename, so a crash leaves the old content or the new content and never a truncated file. A symlinked target keeps its link, an existing file keeps its permission bits, and a target the caller may not write is refused before any temp is created.
* `AtomicDirectory`, `AtomicDirectoryError` and `AtomicDirectoryFiles` live here now, moved from `@effected/store` with no shim. `AtomicDirectory.write` replaces a whole directory by staging it in a sibling and renaming it into place.

The directory holding the target needs write permission: a read-only directory fails loudly, with no non-atomic fallback. A hard link is broken (the name gets a new inode), and ownership, ACLs and extended attributes of the old file are not kept.
