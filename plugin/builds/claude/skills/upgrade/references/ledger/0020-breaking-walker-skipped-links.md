---
id: "0020"
title: "@effected/walker: record mode reports skipped and dangling symbolic links, and the result types gain a required links field"
kind: breaking
shows: typed
applies:
  "@effected/walker": ">=0.31.0"
  "@effected/app": ">=0.35.0"
  "@effected/config-file": ">=0.30.0"
  "@effected/tsconfig-json": ">=0.24.0"
  "@effected/xdg": ">=0.23.0"
detect: ["DescendResult|DescendEntriesResult|onUnreadable: *\"record\"|WalkerSyncFileSystem"]
closes: ["#1432"]
changesets: ["walker-skipped-links", "breaking-floor-effected-app", "breaking-floor-effected-config-file", "breaking-floor-effected-tsconfig-json", "breaking-floor-effected-xdg"]
---

Under `onUnreadable: "record"`, `descend`, `descendEntries` and their sync twins return a new `links` list of `SkippedLink` values (`path`, the link's raw `target`, `kind`). `"directory"` is a directory link the walk did not enter (with `followSymlinks`, only a link that closes a cycle); `"dangling"` is a link that cannot be resolved. Links are reported only from directories the walk actually reads.

- **Break.** `links` is a required member of `DescendResult` and `DescendEntriesResult`. Code that builds one of those values by hand (a test double, a stub) stops compiling; add `links: []`.
- **Adopt.** If the project runs a second walk or a hand-rolled `readDirectory` pass to find directory links or dangling links, use `links` from the record-mode result instead.
- **Sync ports.** `WalkerSyncFileSystem` gains an optional `readLink`. A custom sync port without it walks unchanged and reports NO links, so an empty `links` from such a port proves nothing; add `readLink` (`readlinkSync`'s contract) to get them. `nodeWalkerFileSystem` and `@effected/memfs`'s sync port carry it.

`@effected/app`, `@effected/config-file`, `@effected/tsconfig-json` and `@effected/xdg` raise their peer on `@effected/walker` (and `app` on `@effected/memfs`) across that line, so they publish as minors too: upgrade them together with `walker`. Check the installed `.d.ts` for the exact shapes.
