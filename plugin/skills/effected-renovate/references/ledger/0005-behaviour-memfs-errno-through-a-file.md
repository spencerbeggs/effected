---
id: "0005"
title: "@effected/memfs: a path through a file fails ENOTDIR or ENOENT, not InvalidData, and realPath folds dot segments lexically"
kind: behaviour
shows: behavioural
applies:
  "@effected/memfs": ">=0.26.0"
detect: ["InvalidData"]
changesets: ["memfs-errno-fidelity"]
closes: ["spencerbeggs/effected#1284"]
---

The memory filesystem now answers as `node:fs` does when a path walks through a file. Only a test that asserted the old answers sees it.

- **`remove`, `rename`, `symlink` and `link`** with a `.` or `..` leaf under a file, such as `file/.` or `file/x/..`, fail `ENOTDIR` (reason `BadResource`), or `ENOENT` (reason `NotFound`) when the parent is missing, where they failed `InvalidData`.
- **The `node:fs`-shaped ports**, sync and promises, fail `ENOTDIR` on `file/.`, where they answered the file itself.
- **`realPath`** folds `.` and `..` lexically before it resolves a link, as `fs.realpath` does, so `file.txt/..` is the directory holding `file.txt` even though `stat` of it fails `ENOTDIR`.

Where the search matched `InvalidData` in a test over a memory filesystem, check whether the path runs through a file. If it does, assert the `PlatformError` reason for the errno instead. Where a test expected a port to answer `file/.` or a `realPath` through a file to fail, update the expectation. A hit in production code that matches on `InvalidData` from a real filesystem is not this change.

Run the tests that use `@effected/memfs`; a failure naming one of these shapes is this entry.
