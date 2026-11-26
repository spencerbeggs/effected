---
id: "0021"
title: "@effected/memfs: the sync port gains readLink"
kind: adopt
shows: none
applies:
  "@effected/memfs": ">=0.27.0"
detect: ["syncFileSystem"]
changesets: ["memfs-sync-read-link"]
---

`MemoryFileSystem.syncFileSystem` now has `readLink`, with `readlinkSync`'s contract: the final link's stored target (parent links resolved), `EINVAL` for a non-link, and `ENOENT`, `ENOTDIR` or `ELOOP` for an unreachable path, each with node's exact `code`, `syscall`, `path` and message.

If a test spreads a hand-written `readLink` onto the memfs sync port (for `@effected/walker`'s sync walk, say), drop it and use the port as it is. A fault injected with `withFaults({ sync: { readLink } })` now reaches it. Check the installed `.d.ts`.
