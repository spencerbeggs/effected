# @effected/memfs

In-memory implementation of core Effect's `FileSystem` service: `MemoryFileSystem`, an isolated virtual POSIX volume — files, directories, symlinks, hard links, open descriptors, temporary resources, globbing, watching — behind the standard `FileSystem.FileSystem` key, plus the `@effected/memfs/node-sync` subpath. Pure tier: `effect` is the only peer, zero runtime dependencies, zero `@effected/*` edges, and the memory layers' `R` is `never`. It exists because a hand-rolled `FileSystem.layerNoop` stub answering unarranged reads with `""` caused a real silent-changeset-drop bug (effected#249).

Choosing the form, seeding, faults and the traps that make a memfs test lie → `effect-v4-testing`'s `references/memfs.md`. This file is the surface.

## Import

```ts
import { MemoryFileSystem } from "@effected/memfs";
import type { MemoryFileSystemHandle, MemoryFileSystemSeed } from "@effected/memfs";
import { NodeSyncFileSystem } from "@effected/memfs/node-sync"; // the real disk, read-only, sync
```

The main entry imports nothing from `node:*`; only the `./node-sync` subpath does.

## Constructors

- **`MemoryFileSystem.make` / `MemoryFileSystem.layer`** — an empty volume as `Effect<FileSystem>` / `Layer<FileSystem | MemoryFileSystemVolume>` (the upstream-mirroring pair).
- **`MemoryFileSystem.makeWith(seed?, options?)` / `layerWith(seed?, options?)`** — a seeded volume. `makeWith` keeps a contradictory seed in the typed error channel; `layerWith` dies with it (a wiring bug).
- **`MemoryFileSystem.makeHandle(seed?, options?)`** (`Effect`) / **`makeSync(seed?, options?)`** (synchronous; throws node-shaped errors) — a `MemoryFileSystemHandle`: `fileSystem`, `volume`, a `layer` pinned to that one volume (`FileSystem | MemoryFileSystemVolume | Path`, stable across provides), `sync` and `promises` ports, `root`, `withFaults({ sync?, promises? })`, and setup mutators `write`/`mkdir`/`remove`/`symlink`.
- **`MemoryFileSystem.makeFaulty(base, faults)` / `layerFaulty(faults)`** — delegate-by-default fault injection over ANY `FileSystem`; `layerFaulty` leaves `FileSystem` in `R`.

`options` is `{ root?, caseSensitive?, faults? }`:

- `root` — seed keys are relative to it (`""` is the root itself; it exists even for an empty seed). A **join base, not a jail**: keys join lexically, so `"../x"` under `/ws/repo` is `/ws/x`. The handle's mutators join relative paths to it too, but unnormalized: `..` resolves after links are followed, as `writeFileSync` does. A relative root or an absolute key alongside it is a typed `BadArgument` naming the value.
- `caseSensitive` — `true` by default; `false` models a case-insensitive, case-preserving volume (default APFS), with semantics measured on a real APFS volume.
- `faults` — the fault map (or `(base) => faults` factory) wrapped around the built `FileSystem`. The seed lands beneath the faults; `Volume` inspects the raw volume. It does not reach a handle's ports.

**Every memory layer publishes `MemoryFileSystem.Volume`** beside `FileSystem`; `yield* MemoryFileSystem.Volume` resolves the synchronous, live, **literal** view (`snapshot`, `text`, `bytes`, `has`, `paths`, `readDirectory`, `isDirectory`, `mtime`, `readLink`, `lstat`). Literal means a link is never followed, not even mid-path; absence is `undefined`, never `""`, `[]` or `0`.

## Ports

- **`MemoryFileSystem.syncFileSystem(volume, { faults? })`** — the `node:fs` sync subset: `exists`, `readFile` (UTF-8 string), `readDirectory`, `isDirectory`, `stat`, `lstat`. Structurally satisfies `@effected/workspaces`' `SyncFileSystem` with no import either way.
- **`MemoryFileSystem.promisesFileSystem(volume, { faults? })`** — the `fs/promises` subset an async walker needs: `readdir` (with `withFileTypes`, literal dirents), `stat`, `lstat`, `readFile` with node's overloads (`Uint8Array` without an encoding, `string` with `"utf8"`).

Both follow symlinks (their operations are `stat`-defined) and fail with node's exact error — `code`, `syscall`, `path` and message; a `read` `EISDIR` carries no path, as node's does. The sync port throws; the promises port rejects, even when a fault handler throws synchronously. Members are standalone functions, safe to pass unbound. A fault key naming no member throws `RangeError` at construction.

## Helpers

`MemoryFileSystem.file(content, { mode, mtime })`, `directory({ mode })`, `symlink(target)` (seed entries); `failTimes(n, error)` (a transient fault, counted per execution); `die(defect)` (a defect-arm fault, which `Effect.catch` cannot absorb); `errno(code, syscall, path?)` (the node-shaped error a port fault throws); `Volume` (the context key).

## node-sync

`NodeSyncFileSystem.layer` / `NodeSyncFileSystem.fileSystem` (a value, not an `Effect`) — a read-only, synchronous `FileSystem` over `node:fs`, for programs that must run under `Effect.runSync`. Its read members (`access`/`exists`, `stat`, `readFile`/`readFileString`, `readDirectory`, `readLink`, `realPath`) agree with `@effect/platform-node`'s `NodeFileSystem` value for value and failure for failure, quirks included (`realPath` keeps the queried case; `readDirectory` reports argument errors as `Unknown`). Every other member is a **defect**. Production code, not a test double.

## The founding contract: honest absence

Any read, stat, or open-without-create of an unseeded path fails typed `NotFound` — the volume never fabricates content. That is the whole reason to reach for it over a `FileSystem.layerNoop` stub: a stub answering `""` produces a silent false green, where memfs fails typed and the test names the missing fixture.

## Usage

```ts
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, FileSystem } from "effect";

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readFileString("/repo/package.json");
});

const SeededFs = MemoryFileSystem.layerWith({ "/repo/package.json": `{ "name": "fixture" }` });

program.pipe(Effect.provide(SeededFs));
```

## Gotchas

- **Memoization is per-build, not per-value**: every `Effect.provide` of a layer value — even the same bound `const` — builds and re-seeds a fresh volume. A `Volume` resolved under a second provide inspects a fresh volume, so "nothing was written" passes vacuously. Assert inside the one provide, or use a handle (`makeHandle`/`makeSync`) and its pinned `layer`.
- **Failures take the Node adapter's shape.** The errno rides on `reason.cause.code`, and the `_tag` follows the node adapter's mapping: `ENOENT` → `NotFound`, `EEXIST` → `AlreadyExists`, `EISDIR`/`ENOTDIR`/`ELOOP` → `BadResource`, everything else → `Unknown` (so `readLink` on a non-link is `Unknown`/`EINVAL`, removing a directory without `recursive` is `Unknown`/`ERR_FS_EISDIR`). Match `_tag` + `cause.code` exactly as against `NodeFileSystem.layer`. Where Linux and macOS disagree, the Linux errno is modelled.
- Permission modes are metadata, never enforced, and `access` checks existence only — inject a permission failure with `options.faults`.
- Relative paths resolve from `/`: the volume models no cwd. memfs virtualizes the filesystem, not the platform — code reading `process.platform` still takes the host branch.
- **Sizes are `ByteSize`, seeks are `bigint`, and a seek before the start fails.** `File.Info.size` is a `ByteSize.ByteSize` — read it with `ByteSize.toNumberUnsafe`/`toBigInt`, never `Number(info.size)`; a seek to a negative position fails `BadArgument` and leaves the cursor unchanged.
- The engine is a vendored port of Effect-TS/effect PR #6573 with PR #6555's conformance suite, run against both memfs and the real filesystem as a differential oracle, with a planned sunset when core ships its own in-memory `FileSystem` (the `node-sync` subpath then needs a new home, not deletion). Do not "deduplicate" its embedded mini-glob with `@effected/glob`; the zero-edges law forbids the import.
