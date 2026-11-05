# @effected/files

[![npm](https://img.shields.io/npm/v/@effected%2Ffiles?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/files)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

Atomic file and directory writes for Effect. `AtomicFile.write`: write a temp file beside the target, sync it, and rename it into place, so a crash never leaves a truncated file. A link `realPath` cannot follow is the one exception: it is written through directly. `AtomicDirectory.write` replaces a whole directory so a reader sees the old tree or the new one.

> **Pre-`1.0.0`.** This package is part of the `@effected/*` kit, still in `0.x`
> development.
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version. Full
> policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Why @effected/files

A plain write truncates the file first. A crash or a kill during the write leaves the user with a short or empty file. The fix is a temp file and a rename, which looks like three lines, and those three lines replace a symlink with a regular file, reset the file's permissions, and overflow the name limit on a long file name. This package is that write done once.

## Install

```bash
npm install @effected/files effect
```

```bash
pnpm add @effected/files effect
```

Requires Node.js >=24.11.0. `effect` is a peer dependency. ESM-only: import it from an ES module.

## Usage

```ts
import { AtomicFile } from "@effected/files";

// Effect<void, PlatformError, FileSystem.FileSystem | Path.Path>
const save = AtomicFile.write("/home/me/.config/tool/config.json", '{"theme":"dark"}\n');
```

- **A symlink keeps its link.** The write lands on the file behind it.
- **An existing file keeps its permission bits.**
- **A failure or an interruption before the rename** removes the temp and leaves the target untouched. The one exception is in Limits.
- **Parent directories are not created.** An absent parent fails `NotFound`.

## Replacing a directory atomically

`AtomicDirectory.write(root, files)` replaces the directory at `root` with exactly `files` (any iterable of relative path and content pairs: a `Map`, tuples, `Object.entries(record)`), so a reader sees the old tree or the new one and never a partial write. It needs `FileSystem` and `Path` from your platform layer:

```ts
import { AtomicDirectory } from "@effected/files";

yield* AtomicDirectory.write("/var/cache/app/left-pad", new Map([["package.json", "{}"], ["lib/index.d.ts", "export {};"]]));
```

It stages in the sibling `.<name>.staging` (same parent, so every `rename` stays on one filesystem and is atomic), clears leftover `.<name>.staging` and `.<name>.old` siblings from a crashed run first, creates staging even for an empty set, and writes every file with its parent directories. It then renames the live directory to `.<name>.old`, renames staging into place, and removes `.<name>.old`, so the old tree is only deleted once no reader can reach it. Both siblings belong to the writer and are removed with force. Two things to design around:

- **A brief absence window.** Between the two renames, `root` does not exist. A reader in that window sees a missing directory, never a partial one, so treat absence as a miss. A crash inside the window leaves `root` absent with the old tree whole in `.<name>.old` and the new one whole in staging; the next call recovers.
- **One writer per root.** The sibling names are fixed, which is what lets a later call clean up a crashed one. Serialize writes to the same `root`.

`root` is normalised first, and one whose basename is `.` or `..` is refused, as is a file path that is empty, absolute or climbs out of the directory, all before anything is touched. Failures are `AtomicDirectoryError`, which carries an `operation` of `validate`, `clear`, `stage`, `write`, `promote` or `cleanup`, the `path` it was working on and the structural `cause`. A `write` failure leaves the live tree untouched; a `promote` failure can leave it absent, and the next call recovers; a `cleanup` failure means the new tree is live and only the old one is left over.

## Limits

- The directory needs write permission. A read-only directory fails, with no non-atomic fallback.
- A hard link is broken: other names for the old inode keep the old content.
- The directory is not synced, so the rename itself may not survive power loss.
- A killed process can leave a `.effected-*.tmp` file beside the target.
- A link `realPath` cannot follow (dangling, or with a symlink before `..` in its text under Node) is written through directly, without atomicity.
- Windows can refuse the rename while a reader holds the file.

## License

[MIT](LICENSE)
