---
"@effected/walker": minor
---

## Breaking Changes

### `WalkerSyncFileSystem` requires `readFile`

The sync port gains a required `readFile` member, which answers a file's text as UTF-8 with links followed. A missing path or a directory throws node-shaped `ENOENT` and `EISDIR` errors, like the port's other members.

To migrate, add the member to a hand-written port. The compiler finds every site. `nodeWalkerFileSystem` and a `@effected/memfs` handle's `sync` port already carry it.

```ts
readFile: (path) => readFileSync(path, "utf8"),
```

### `descend` reads only directories a match can lie in

`descend`, `descendEntries`, `descendSync` and `descendEntriesSync` give the same matches and read fewer directories. A pattern with no globstar is never read below the depth its segments reach, and under `dot: false` a hidden directory is entered only when a segment names one. A read the walk skips cannot fail it, which changes three things:

* `maxDepth` applies only to directories the walk reads, so `packages/*/README.md` under a cap of 1 succeeds on a deep tree. Going past the cap where a match could lie is still a typed `depthExceeded`. Rewrite a test or guard that expected `depthExceeded` from a bounded pattern
* An unreadable directory out of the pattern's reach does not fail the walk under `onUnreadable: "fail"`, and is not recorded under `"record"`. Move a test's unreadable fixture to where a match could lie
* A test that counts reads or spies on the port sees fewer of them. Update the expected list

## Features

### `Walker.findUpwardSyncWith`

Climbs to the nearest directory an `accept` function takes, such as the nearest *valid* `package.json`. It takes the directories to try, nearest first, from `ascendSync`, `ascendWithinSync` or `ascendToMarkerSync`, and `accept` answers an `Option` for each. The result is an `Option` of the accepted `dir` and its `value`. `options.cache`, a `Map` or anything with its `get` and `set`, memoizes each directory's answer for hot paths.

### `PosixPath`

A root export of synchronous POSIX path functions that never read the working directory, for pure code that cannot put `Path` in `R`: `sep`, `join`, `normalize`, `relative`, `dirname`, `basename`, `extname` and `isAbsolute`. There is no `resolve`, and `relative` throws on a question only a working directory could answer.
