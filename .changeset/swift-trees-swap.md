---
"@effected/store": minor
---

## Features

### `AtomicDirectory.write`

`AtomicDirectory.write(root, files)` replaces the directory at `root` with exactly `files`, so a reader sees the old tree or the new one and never a partial write. `files` is any iterable of relative path and content pairs: a `Map`, tuples, or `Object.entries(record)`. It needs `FileSystem` and `Path` from your platform layer. Closes #144.

```ts
import { AtomicDirectory } from "@effected/store";

yield* AtomicDirectory.write(
  "/var/cache/app/left-pad",
  new Map([["package.json", "{}"], ["lib/index.d.ts", "export {};"]]),
);
```

The new tree is staged in a sibling directory and renamed into place. Between the two renames `root` briefly does not exist, so treat absence as a cache miss; the renames are uninterruptible, so a fiber interrupt cannot widen that window. Run one writer per `root`. A run that crashed between the renames is repaired by the next call, which puts the old tree back under `root` before it stages. Failures are `AtomicDirectoryError`, which carries the `operation` that failed (`validate`, `clear`, `stage`, `write`, `promote` or `cleanup`), the `path` and the `cause`.

## Documentation

- The README describes how to test a service built on `Store`: run the real implementation over `Store.layerTest`'s in-memory SQLite through a `layerMemory()` factory instead of writing a hand-rolled double.
