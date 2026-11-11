---
id: "0014"
title: "@effected/memfs: a . or .. leaf on a directory fails with node's errno, and the sync port's realPath throws lstat or stat errors"
kind: behaviour
shows: behavioural
applies:
  "@effected/memfs": ">=0.26.1"
detect: ["[\"']InvalidData[\"']", "syscall\"?[[:space:]]*:[[:space:]]*[\"']realpath[\"']"]
changesets: ["memfs-errno-fidelity-2"]
closes: ["spencerbeggs/effected#1327", "spencerbeggs/effected#1328"]
---

The memory filesystem now gives the same errors as `node:fs` in two more cases. You only see the change if a test asserted the old answers.

- **A `.` or `..` leaf on a directory**, such as `dir/.` or `dir/sub/..`, no longer fails `InvalidData`. `remove` fails `ERR_FS_EISDIR`, or `EINVAL` with `recursive`, and removes nothing. Both errors have the reason `Unknown`. `rename` with such a leaf on either side fails `EBUSY` (reason `Busy`), which is Linux's errno; macOS reports `EINVAL`. `symlink` and `link` fail `EEXIST` (reason `AlreadyExists`).
- **The sync port's `realPath`** throws what the JS `realpathSync` throws. A missing component, or one under a file, fails with `syscall: "lstat"`. A link that does not resolve fails with `syscall: "stat"`. In both cases `path` names the prefix that was examined, with the links before it already resolved, so it is not always the caller's path. No error uses the syscall `realpath` anymore.

Where the search matched a quoted `InvalidData` in a test over a memory filesystem, check whether the path ends in `.` or `..` under a directory. If it does, assert the reason for the errno instead. A match in production code that checks a real filesystem, or another package's own `InvalidData` error, is not this change.

Where the search matched `syscall: "realpath"` against the memfs sync port, assert `lstat` or `stat` as described above. Also check any `path` assertion on a failure that is deeper than the caller's first missing component. Check the installed `MemoryFileSystem` `.d.ts` for the TSDoc on `realPath`.

Run the tests that use `@effected/memfs`. A failure that names one of these shapes comes from this entry.
