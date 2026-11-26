---
"@effected/walker": minor
---

## Features

### Record mode reports the symbolic links a walk passes over

Under `onUnreadable: "record"`, `descend`, `descendEntries` and their sync twins return `links`, a list of `SkippedLink` (`path`, the link's raw `target`, and `kind`):

* `"directory"`: a directory link the walk does not enter; with `followSymlinks`, only a link that closes a cycle
* `"dangling"`: a link that cannot be resolved

Only directories the walk reads are seen, so nothing under a pruned, boundary or out-of-depth directory is reported, and the other modes do no extra work.

`WalkerSyncFileSystem` gains an optional `readLink`; `nodeWalkerFileSystem` provides it. A sync port without it reports no links.

## Breaking Changes

* `links` is a required field of `DescendResult` and `DescendEntriesResult`. Code that builds one of those values by hand must add `links: []`
