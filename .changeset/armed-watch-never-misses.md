---
"@effected/jsonl": minor
---

## Breaking Changes

`Journal.layer` and `Journal.make` now require a `JournalWatcher` in `R`, alongside `FileSystem`. Provide it once at the edge: on Node, add `NodeJournalWatcher.layer` from the new `@effected/jsonl/node` subpath next to `NodeFileSystem.layer`.

```ts
import { NodeJournalWatcher } from "@effected/jsonl/node";
import { NodeFileSystem } from "@effect/platform-node";

// before: Effect.provide(NodeFileSystem.layer)
// after:  Effect.provide([NodeFileSystem.layer, NodeJournalWatcher.layer])
```

## Features

### JournalWatcher service

A new root export, `JournalWatcher` (with its `JournalWatcherShape`), describes how a journal is told its file changed. `watch(path)` succeeds only once the platform watch is registered, so the journal can arm the watch, catch up on what it missed, then follow the stream without a gap. The root still never imports `node:*`; on other platforms, implement the shape over the platform's own watch primitive.

### Node backend

`@effected/jsonl/node` exports `NodeJournalWatcher`, whose `layer` provides `JournalWatcher` over `node:fs`.

## Bug Fixes

* A journal no longer misses an append that lands while its file watch is being set up. The watch used to be armed by yielding to the scheduler a few times before the catch-up read, so under load the catch-up could run before the platform watch registered. Two journal layers over one file now reliably observe each other's appends.
* A journal file created while the directory watch was being set up is no longer missed on activation.
* A journal whose file is replaced by a rename over it (an atomic `mv tmp journal`) now follows the new file. The Node watch stayed attached to the old inode and never ended, so every append after the replacement went unseen.
