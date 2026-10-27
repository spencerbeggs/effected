---
"@effected/walker": minor
---

## Breaking Changes

* The sync entry field `stat` is renamed `info`.
* The four sync-only result types are gone. `descendSync` and `descendEntriesSync` return the shared `DescendResult` and `DescendEntry`.
* With `followSymlinks` off (the default), a symlinked walk base and a symlinked directory on a literal pattern's path are no longer entered. A literal that is itself a link to a file still matches.

## Features

* `boundaries` stops descent at marker files such as `package.json`, and `descendEntries` returns the stat info the walk already read.
* `@effected/walker/node-sync` provides the Node sync bindings; a memfs handle satisfies the sync port directly.

## Bug Fixes

* Brace-only patterns such as `src/{a,b}.test.ts` returned nothing. Each alternative is now walked from its own root, each directory is read once, and each match is returned once, spelled as the earliest alternative.
