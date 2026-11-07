# @effected/files

`AtomicFile.write` refuses a target the caller may not write, then replaces one file through a temp file beside it, a sync and a rename, so a crash leaves the old content or the new content and never a truncated file. A symlinked target is followed by default or replaced on request; when following, a link `realPath` cannot follow is the one exception: it is written through directly. `FileSystem` and `Path` are in `R`, and the error is plain `PlatformError`, so an adopter keeps its existing `mapError`.

## Import

```ts
import { AtomicDirectory, AtomicFile } from "@effected/files";
import type { AtomicFileOptions } from "@effected/files";
```

## Core API

- **`AtomicDirectory.write(root, files)`** → `Effect<void, AtomicDirectoryError, FileSystem | Path>`: replace a directory atomically (a cache's per-package tree, a generated output dir) instead of hand-rolling the staging dance. Stages in the sibling `.<name>.staging` (same parent, so the `rename` is same-filesystem atomic), clears leftover staging first, creates staging even for an empty set, writes files with parents, then removes live and renames staging in. `files` is any iterable of `[relativePath, string | Uint8Array]`; an empty, absolute or escaping path fails `operation: "validate"` before any IO. A brief window exists where `root` is ABSENT (never half-written): treat absence as a miss. One writer per `root` (fixed staging name). Needs no SQLite.
- **`AtomicFile.write(target, content, options?)`**: `content` is a string, written as UTF-8, or a `Uint8Array`, written verbatim. Returns `Effect<void, PlatformError, FileSystem.FileSystem | Path.Path>`. `AtomicFileOptions.links` decides what a symbolic link at `target` itself means, and any other value is a defect:

| `target` is | `links: "follow"` (default) | `links: "replace"` |
| --- | --- | --- |
| a link to an existing file | that file is replaced atomically; the link stays | the link is replaced atomically by a regular file; the file it pointed to is not read, checked or written |
| a dangling link | the file is created where the link points, written directly without atomicity; the link stays | the link is replaced atomically; nothing is created where it pointed |
| a regular file or absent | replaced or created atomically | the same |

Pass `{ links: "replace" }` from a tool writing into a checkout nobody has reviewed: under `"follow"`, a committed `config.json -> ~/.ssh/authorized_keys` makes a mutating command overwrite the outside file. Keep `"follow"` for a dotfile a user links in on purpose.

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
- **By default a symlink survives.** The write lands on the file behind the link; `{ links: "replace" }` replaces the link instead.
- **Under `"follow"`, a link `realPath` cannot follow (dangling, or with a symlink before `..` in its text under Node) is written through directly, without atomicity.**
- **`links` governs only the last component of `target`.** A symlinked parent directory is traversed in both modes, so when the parents are not trusted either, check the target with `@effected/walker`'s `confineReal` first.
- **The kit's writers built on it follow links and take no `links` option** (`PackageJsonFile`, `ConfigFile`, `ManagedSection`, `SchemaFile`, `effected schema build`). A tool that must not follow links into an untrusted checkout calls `AtomicFile.write` itself or confines the path first.
- **`AtomicDirectory.write` never writes through a symlinked `root`.** A link to a directory is renamed aside and removed, leaving the tree it pointed to alone; a dangling link fails with operation `promote`. Symlinked parents of `root` are traversed.
- **An existing file keeps its permission bits.** A new file gets the platform default. Under `"replace"` the link's destination contributes no permission bits: the new file is a fresh file.
- **The directory needs write permission.** A read-only directory fails, with no non-atomic fallback.
- **A read-only target file is refused** with `PermissionDenied` before any temp is created, as a plain write would; root bypasses it.
- **Ownership, ACLs and extended attributes are not kept**, because a rename creates a new inode.
- **A hard link is broken.** Other names for the old inode keep the old content.
- **The directory is not synced**, so the rename itself may not survive power loss.
- **A killed process can leave a `.effected-*.tmp`** beside the target. Nothing sweeps it.
- **Windows can refuse the rename** while a reader holds the file.

## Testing

Provide `MemoryFileSystem.layerWithPath` from `@effected/memfs`. Fault `rename` to fail the swap, and wrap the file from an `open` fault with `MemoryFileSystem.wrapFile` to fail `writeAll` or `sync`. `writeFile` faults reach only the write-through path, because the atomic path writes through `open`.
