# @effected/files

[![npm](https://img.shields.io/npm/v/@effected%2Ffiles?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/files)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

Atomic file and directory writes for Effect. `AtomicFile.write`: refuse a target the caller may not write, then write a temp file beside it, sync it, and rename it into place, so a crash never leaves a truncated file. A symlinked target is followed by default, or replaced with `{ links: "replace" }`. When following, a link `realPath` cannot follow is the one exception: it is written through directly. `AtomicDirectory.write` replaces a whole directory so a reader sees the old tree or the new one.

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

- **A symlink keeps its link by default.** The write lands on the file behind it. Pass `{ links: "replace" }` to replace the link itself instead (see below).
- **An existing file keeps its permission bits**, and one the caller may not write is refused.
- **A failure or an interruption before the rename** removes the temp and leaves the target untouched. The one exception is in Limits.
- **Parent directories are not created.** An absent parent fails `NotFound`.

## Following or replacing a symlinked target

`AtomicFile.write(target, content, options?)` takes `links`, which decides what a symbolic link at `target` itself means:

```ts
import { AtomicFile } from "@effected/files";

// The default: write the file the link points to, and keep the link.
yield* AtomicFile.write("/home/me/.zshrc", text);

// Replace the link with a regular file, leaving whatever it pointed to alone.
yield* AtomicFile.write("/repo/.config/tool.json", text, { links: "replace" });
```

| `target` is | `links: "follow"` (default) | `links: "replace"` |
| --- | --- | --- |
| a link to an existing file | that file is replaced atomically; the link stays | the link is replaced atomically by a regular file; the file it pointed to is not read, checked or written |
| a dangling link | the file is created where the link points, written directly without atomicity; the link stays | the link is replaced atomically; nothing is created where it pointed |
| a regular file or absent | replaced or created atomically | the same |

Under `"replace"` the temp file is created in the link's own directory, and the link's destination contributes no permission bits and no `access` check: the new file is a fresh file. `"follow"` is the default because keeping a link is right for a dotfile a user links in on purpose. Any other value of `links` is a defect.

Either way only the last component of `target` is governed. A symlinked parent directory is traversed, as with any path, so `/repo/sub/config.json` with `sub` linked elsewhere lands elsewhere in both modes. When the parents are not trusted either, check the target with `@effected/walker`'s `confineReal` before writing.

## Symlinked targets and untrusted checkouts

A tool that writes into a repository can be pointed outside it by a symlink committed to that repository. Under `"follow"`, a committed `config.json -> /home/me/.ssh/authorized_keys` makes a mutating command overwrite the outside file, and a dangling one makes it create a file outside. The random `.effected-*.tmp` temp name, opened with `wx`, closes the related attack of planting a link at a predictable temp name, so a consumer gains nothing by hand-rolling a fixed-name temp and rename.

The severity is low. The attacker needs a committed symlink and someone running a mutating command in that checkout, where `pnpm install` would already run the checkout's own code. It matters most for agent-driven tools and long-running servers acting on a checkout nobody has reviewed. Pass `{ links: "replace" }` to `AtomicFile.write` there, and confine the path when its parent directories are not trusted either.

The kit's own writers built on `AtomicFile.write` all **follow** links, and none of them takes a `links` option yet:

| Writer | Package | Links |
| --- | --- | --- |
| `PackageJsonFile` writes | `@effected/package-json` | follow |
| `ConfigFile` writes | `@effected/config-file` | follow |
| `ManagedSection` writes | `@effected/templates` | follow |
| `SchemaFile` writes | `@effected/schemastore` | follow |
| `effected schema build` output | `@effected/engine` | follow |

Passing the option through each writer is a follow-up. Until then, a tool that must not follow links into an untrusted checkout writes through `AtomicFile.write` with `{ links: "replace" }` itself, or confines the path first.

`AtomicDirectory.write` never writes through a symlinked `root`. A link to a directory is renamed aside and removed, so the new tree takes its place and the tree it pointed to is left alone. A dangling link fails with operation `promote` and creates nothing where it points. Symlinked parent directories of `root` are traversed.

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
- A read-only target is refused with `PermissionDenied` before any temp is created, as a plain write would. The check asks the platform, so root bypasses it, as it does a plain write.
- A hard link is broken: other names for the old inode keep the old content.
- A rename creates a new inode, so ownership, ACLs and extended attributes are not kept.
- The directory is not synced, so the rename itself may not survive power loss.
- A killed process can leave a `.effected-*.tmp` file beside the target.
- Under the default `links: "follow"`, a link `realPath` cannot follow (dangling, or with a symlink before `..` in its text under Node) is written through directly, without atomicity. `links: "replace"` has no such case.
- Windows can refuse the rename while a reader holds the file.

## License

[MIT](LICENSE)
