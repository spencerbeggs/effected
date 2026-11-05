# @effected/files

`AtomicFile.write` replaces one file through a temp file beside it, a sync and a rename, so a crash leaves the old content or the new content and never a truncated file. `FileSystem` and `Path` are in `R`, and the error is plain `PlatformError`, so an adopter keeps its existing `mapError`.

## Import

```ts
import { AtomicFile } from "@effected/files";
```

## Core API

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
- **A symlink survives.** The write lands on the file behind the link, and a dangling link creates that file.
- **An existing file keeps its permission bits.** A new file gets the platform default.
- **The directory needs write permission.** A read-only directory fails, with no non-atomic fallback.
- **A hard link is broken.** Other names for the old inode keep the old content.
- **The directory is not synced**, so the rename itself may not survive power loss.
- **A killed process can leave a `.effected-*.tmp`** beside the target. Nothing sweeps it.
- **Windows can refuse the rename** while a reader holds the file.

## Testing

Provide `MemoryFileSystem.layerWithPath` from `@effected/memfs`. Fault `rename` to fail the swap, and wrap the file from an `open` fault with `MemoryFileSystem.wrapFile` to fail `writeAll` or `sync`. `writeFile` faults do not reach this code, because it writes through `open`.
