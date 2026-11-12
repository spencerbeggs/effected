---
id: "0010"
title: "@effected/memfs: copy onto dir/., rename of the root, the win32 realPath error path and realPath through a link's .. now answer as node:fs does, and an empty link target no longer resolves to its parent"
kind: behaviour
shows: behavioural
applies:
  "@effected/memfs": ">=0.26.2"
detect: ["[\"']InvalidData[\"']", "EISDIR", "pathStyle:[[:space:]]*[\"']win32"]
changesets: ["memfs-errno-fidelity"]
closes: ["spencerbeggs/effected#1339"]
---

The memory filesystem now gives node's answers in four more places, each probed against real `node:fs` on macOS and Linux. Only a test that asserted the old answers sees a change.

- **`copy` onto a `dir/.` or `dir/..` destination** used to fail `InvalidData`. A file source now fails with reason `Unknown` and `cause.code` `ERR_FS_CP_NON_DIR_TO_DIR`. A directory source merges into the directory the dot names when `overwrite` is set, and fails `AlreadyExists` (`EEXIST`) without it. Copying a directory onto its own `d/.` or `d/..` fails `Unknown` with `ERR_FS_CP_EINVAL`.
- **`rename` involving the root `/`**, on either side, used to fail `BadResource` (`EISDIR`). It now fails `Busy` (`EBUSY`), Linux's answer, once both parents resolve. A missing or file parent still fails first: `rename("/", "missing/x")` is `NotFound` and `rename("/", "file/x")` is `BadResource` (`ENOTDIR`).
- **The sync port's `realPath` under `pathStyle: "win32"`** names the backslashed prefix the walk failed at, such as `C:\repo\absent`, not the caller's path. Through a link it names the target's prefix, and a missing drive names the drive root, such as `D:\`. Every other port member still reports the caller's path.
- **`realPath` of a link whose target holds `..`**, such as `a -> sub/../b` where `sub` is itself a link, now folds the `..` lexically as `fs.realpath` does. It answers the `b` beside `a`, where it answered the physical one, and fails `NotFound` unless both exist.

- **A symbolic link with an empty target**, which macOS lets you create and Linux refuses, no longer resolves to the link's parent directory: `stat`, `realPath`, `readDirectory` and `exists` through it fail `NotFound`, as `node:fs` does, and `readLink` still answers `""`.

One case stays different on purpose: `copy` onto `missing/.` fails `NotFound`, where node first creates `missing/`.

Where the search matched a quoted `InvalidData` or an `EISDIR` in a test over a memory filesystem, check whether the operation is one of the four above, and assert the new reason and errno. Where it matched `pathStyle: "win32"`, check any `path` asserted on a `realPath` failure. A match in production code that inspects a real filesystem is not this change. Run the tests that use `@effected/memfs`.
