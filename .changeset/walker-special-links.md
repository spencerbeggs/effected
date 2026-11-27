---
"@effected/walker": minor
---

## Features

### Record mode reports links to devices, FIFOs and sockets

Under `onUnreadable: "record"`, a symbolic link whose target is neither a regular file nor a directory (`notes.md -> /dev/null`, a FIFO, a socket) is now listed in `links` as a `SkippedLink` of kind `"special"`. It is reported for every such link in a directory the walk reads, whatever the pattern, so record mode now reports every link it neither enters nor matches. Such a link is still never matched or opened. To learn which kind of special file it is, `stat` the link's own path under `cwd`, which follows the link; never `stat` the raw `target` text, which may be relative to the link's directory.

## Breaking Changes

* `SkippedLink["kind"]` widens from `"directory" | "dangling"` to `"directory" | "dangling" | "special"`. An exhaustive `switch` over it stops compiling until it handles `"special"`
* Code that tests one kind and treats every other link as the remaining one (`if (link.kind === "dangling") … else` handled as a directory link) still compiles, and now sends every special link down that branch. Give `"special"` its own handling
