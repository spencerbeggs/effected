---
"@effected/memfs": minor
---

## Breaking Changes

* `NodeDirectorySeed` now refuses a symlink that leaves and re-enters the fixture (such as `../fixture/a.txt`), not only one that ends outside it. Rewrite such a link to a path inside the fixture.

## Features

* `NodeDirectorySeed.read` on the `node-sync` subpath seeds a volume from a real fixture directory: sync and byte-exact, absolute under `mountAt` or relative for the `root` option. Symlinks are copied as links, modes only on request, files are capped with `EFBIG`, and FIFOs, sockets and devices are refused (#1125).
* The win32 port answers `realPath` in win32 spelling instead of the POSIX `/C:/repo` form.

## Bug Fixes

### Security

* `NodeDirectorySeed` closes two escape paths. A link's target is resolved one segment at a time against the real filesystem, following every link on the way, so a dangling link can no longer escape through a lexical check (`sub/up -> ..`, `sub/out -> up/../nope`); a link that leaves the fixture throws `ERR_SEED_SYMLINK_ESCAPE`. A file is read through `O_NOFOLLOW` and checked by `fstat` against the walk's `lstat` (device and inode), so a file swapped for a link or grown past `maxFileBytes` between the check and the read throws `ERR_SEED_CHANGED`.
* `NodeDirectorySeed.read` re-checks a directory before listing it, so a directory swapped for a link (or for another directory) between the walk's check and its listing throws `ERR_SEED_CHANGED`; `mountAt` is trimmed in linear time.
