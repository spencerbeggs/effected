# @effected/files

[![npm](https://img.shields.io/npm/v/@effected%2Ffiles?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/files)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

Atomic single-file writes for Effect: write a temp file beside the target, sync it, and rename it into place, so a crash never leaves a truncated file.

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

- **A symlink keeps its link.** The write lands on the file behind it, and a dangling link creates that file.
- **An existing file keeps its permission bits.**
- **A failure or an interruption before the rename** removes the temp and leaves the target untouched.
- **Parent directories are not created.** An absent parent fails `NotFound`.

## Limits

- The directory needs write permission. A read-only directory fails, with no non-atomic fallback.
- A hard link is broken: other names for the old inode keep the old content.
- The directory is not synced, so the rename itself may not survive power loss.
- A killed process can leave a `.effected-*.tmp` file beside the target.
- Windows can refuse the rename while a reader holds the file.

## License

[MIT](LICENSE)
