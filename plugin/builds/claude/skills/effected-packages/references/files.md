# @effected/files

`AtomicFile.write` refuses a target the caller may not write, then replaces one file through a temp file beside it, a sync and a rename, so a crash leaves the old content or the new content and never a truncated file. A link `realPath` cannot follow is the one exception: it is written through directly. `FileSystem` and `Path` are in `R`, and the error is plain `PlatformError`, so an adopter keeps its existing `mapError`.

## Import

```ts
import { AtomicDirectory, AtomicFile } from "@effected/files";
```

## Core API

- **`AtomicDirectory.write(root, files)`** → `Effect<void, AtomicDirectoryError, FileSystem | Path>`: replace a directory atomically (a cache's per-package tree, a generated output dir) instead of hand-rolling the staging dance. Stages in the sibling `.<name>.staging` (same parent, so the `rename` is same-filesystem atomic), clears leftover staging first, creates staging even for an empty set, writes files with parents, then removes live and renames staging in. `files` is any iterable of `[relativePath, string | Uint8Array]`; an empty, absolute or escaping path fails `operation: "validate"` before any IO. A brief window exists where `root` is ABSENT (never half-written): treat absence as a miss. One writer per `root` (fixed staging name). Needs no SQLite.
- **`AtomicFile.write(target, content)`**: `content` is a string, written as UTF-8, or a `Uint8Array`, written verbatim. Returns `Effect<void, PlatformError, FileSystem.FileSystem | Path.Path>`.

## Usage

```ts
import { AtomicFile } from "@effected/files";
import { Effect, FileSystem, Path } from "effect";

const save = (file: string, text: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.makeDirectory(path.dirname(file), { recursive: true });
    yield* AtomicFile.write(file, text);
  });
```

## Gotchas

- **Parent directories are not created.** An absent parent fails `NotFound`, so make the directory first.
- **A symlink survives.** The write lands on the file behind the link.
- **A link `realPath` cannot follow (dangling, or with a symlink before `..` in its text under Node) is written through directly, without atomicity.**
- **An existing file keeps its permission bits.** A new file gets the platform default.
- **The directory needs write permission.** A read-only directory fails, with no non-atomic fallback.
- **A read-only target file is refused** with `PermissionDenied` before any temp is created, as a plain write would; root bypasses it.
- **Ownership, ACLs and extended attributes are not kept**, because a rename creates a new inode.
- **A hard link is broken.** Other names for the old inode keep the old content.
- **The directory is not synced**, so the rename itself may not survive power loss.
- **A killed process can leave a `.effected-*.tmp`** beside the target. Nothing sweeps it.
- **Windows can refuse the rename** while a reader holds the file.

## Testing

Provide `MemoryFileSystem.layerWithPath` from `@effected/memfs`. Fault `rename` to fail the swap, and wrap the file from an `open` fault with `MemoryFileSystem.wrapFile` to fail `writeAll` or `sync`. `writeFile` faults reach only the write-through path, because the atomic path writes through `open`.
