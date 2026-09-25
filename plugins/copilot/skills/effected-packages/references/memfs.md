# @effected/memfs

In-memory implementation of core Effect's `FileSystem` service: one class, `MemoryFileSystem`, providing an isolated virtual POSIX volume — files, directories, symlinks, hard links, open descriptors, temporary resources, globbing, watching — behind the standard `FileSystem.FileSystem` key. Pure tier: `effect` is the only peer, zero runtime dependencies, and the self-contained layers' `R` is `never` — the package *provides* `FileSystem`, requiring nothing (the one exception is the `layerFaulty` wrapper, which decorates a base `FileSystem` you supply). Born in the 2026-08-14 wave (effected#249): a hand-rolled `FileSystem.layerNoop` stub answering unarranged reads with `""` caused a real silent-changeset-drop bug, and this package exists to kill that footgun.

## Import

```ts
import { MemoryFileSystem } from "@effected/memfs";
import type { MemoryFileSystemSeed } from "@effected/memfs";
```

Single entrypoint; no subpaths.

## Core API

- **`MemoryFileSystem.layer`** — `Layer<FileSystem.FileSystem>` backed by a fresh, empty volume.
- **`MemoryFileSystem.layerWith(seed)`** — same, pre-populated from a `MemoryFileSystemSeed`: absolute POSIX paths mapped to entries: `string` (UTF-8-encoded), `Uint8Array` (written verbatim), or the tagged entries built with `MemoryFileSystem.file`, `MemoryFileSystem.directory` and `MemoryFileSystem.symlink`, so one seed literal can describe a whole tree — empty directories, symbolic links, and initial permission modes included. Parent directories are created recursively before each entry. A self-contradictory seed (a file seeded at a path another entry needs as a directory) is a test-wiring bug and **dies** with the typed error as its cause.
- **`MemoryFileSystem.make` / `makeWith(seed)`** — the effect-level constructors: `Effect<FileSystem.FileSystem>` / `Effect<FileSystem.FileSystem, PlatformError>`. `makeWith` keeps seeding failures in the typed error channel where `layerWith` converts them to a defect.
- **`MemoryFileSystem.layerInspectable` / `layerInspectableWith(seed)`** — `Layer<FileSystem.FileSystem | MemoryFileSystemVolume>`: one volume published twice, as the filesystem and as a synchronous read-back view (`snapshot()`, `text`, `bytes`, `has`, `paths`, `readDirectory`, `isDirectory`, `mtime`, `readLink`) resolved with `yield* MemoryFileSystem.Volume`.
- **`MemoryFileSystem.makeInspectable` / `makeInspectableWith(seed)`** — the value-level pair `{ fileSystem, volume }` over one volume; the seeded form fails typed.
- **`MemoryFileSystem.syncFileSystem(volume)`** — the synchronous port over a `MemoryFileSystemVolume` whose members are `exists`, `readFile`, `readDirectory` and `isDirectory`, modeling the `node:fs` synchronous subset (`existsSync`, `readFileSync(p, "utf8")`, `readdirSync`, `statSync(p).isDirectory()`) — the structural port consumer packages' sync entry points ask for. It follows symbolic links where the literal volume view does not, and absence **throws** Node-style errors carrying `code`/`syscall`/`path` (`ENOENT` for an absent path, `EISDIR` for reading a directory as a file, `ENOTDIR` for listing a non-directory) — it never answers `undefined` the way the literal volume view does.
- **`MemoryFileSystem.layerFaultyWith(seed, faults)` / `layerFaulty(faults)` / `makeFaulty(fileSystem, faults)`** — delegate-by-default fault injection: per intercepted method a handler replaces the call (typically `Effect.fail(PlatformError.systemError({...}))`), `undefined` declines and delegates to the wrapped filesystem, and `failTimes(n, error)` builds a transient fault failing `n` calls then delegating forever. The naming points the opposite way from the `R` types: `layerFaultyWith` is self-contained (`R = never`), while `layerFaulty` wraps a base and so leaves `FileSystem.FileSystem` in `R` — for the no-seed standalone case reach for `layerFaultyWith({}, faults)`, not `layerFaulty(faults)`.

## The founding contract: honest absence

Any read, stat, or open-without-create-flag of an unseeded path fails typed `NotFound` (`SystemError`) — the volume never fabricates content for a path nothing arranged. That is the whole reason to reach for it over hand-stubbing `FileSystem.layerNoop`: a stub answering unarranged reads with `""` produces a silent false green (a phantom file parsing as empty), where memfs fails typed and the test names the missing fixture.

## Usage

```ts
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, FileSystem } from "effect";

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readFileString("/repo/package.json");
});

const SeededFs = MemoryFileSystem.layerWith({
  "/repo/package.json": `{ "name": "fixture" }`,
});

program.pipe(Effect.provide(SeededFs));
```

## Asserting on writes: the re-seed hazard

The layer forms build — and re-seed — a fresh volume **per provide**, and a second `Effect.provide` of the same layer *value* counts as another provide:

```ts
const layers = MemoryFileSystem.layerInspectableWith({ "/repo/out.txt": "before" });
const write = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.writeFileString("/repo/written.txt", "content");
});
yield* Effect.provide(write, layers); // the write lands in ONE volume
const volume = yield* Effect.provide(MemoryFileSystem.Volume, layers); // a FRESH volume
assert.isFalse(volume.has("/repo/written.txt")); // passes vacuously — nothing was ever written here
```

Every "nothing was written" assertion passes regardless of what the code did — a silent false green in exactly the assertion class the inspectable pair exists to serve. Two safe shapes:

- **Assertions inside the program** — resolve `MemoryFileSystem.Volume` under the same `Effect.provide` the code under test runs under, so both halves observe one volume.
- **Assertions after the run** — build the pair once with `makeInspectableWith(seed)`, wrap it in `Layer.succeed(FileSystem.FileSystem, pair.fileSystem)` (optionally decorated by `makeFaulty` first), and assert on `pair.volume` — the identity is pinned.

For fault injection plus read-back in one graph, compose the layers so the decorated `FileSystem` wins while `Volume` survives:

```ts
const layers = MemoryFileSystem.layerFaulty(faults).pipe(
  Layer.provideMerge(MemoryFileSystem.layerInspectableWith({})),
);
```

## Testing machinery

The package *is* testing machinery — reach for it in any test needing a filesystem, in any kit package: it has **zero `@effected/*` edges by law** (runtime, peer, or dev), so any package — `glob` included — may devDepend on it without creating a cycle.

## Gotchas

- **`layerWith` is a parameterized layer factory** — fresh reference per call: bind the result to a `const`. Memoization is per-build, not per-value: every `Effect.provide` of a layer value — even the same bound `const` — builds and re-seeds a fresh volume. Sharing one volume across effects takes one provide of one composed layer graph; `Layer.fresh` only opts a consumer *inside* that graph back out into its own volume.
- Malformed input fails through the typed `PlatformError` channel (`badArgument`/`systemError`), never as a defect; pathological directory or brace-nesting depth fails typed at the engine's bound (`MAX_NESTING_DEPTH = 256`), never a stack overflow.
- **Failures take the Node adapter's shape.** Each errno-backed failure carries node's code as `reason.cause.code`, and the `_tag` follows the node adapter's mapping: `ENOENT` → `NotFound`, `EEXIST` → `AlreadyExists`, `EISDIR`/`ENOTDIR`/`ELOOP` → `BadResource`, everything else → `Unknown`. So `readLink` on a non-link is `Unknown`/`EINVAL`, renaming onto a non-empty directory `Unknown`/`ENOTEMPTY`, removing any directory without `recursive` `Unknown`/`ERR_FS_EISDIR`, a closed or wrong-mode handle `Unknown`/`EBADF`. Match `_tag` + `cause.code` exactly as against `NodeFileSystem.layer`; never write a test that only passes because memfs said `BadResource`. Where Linux and macOS disagree the Linux errno is modelled. Unlike node's `ErrnoException`, the `cause` carries only `code` (plus `path` for a path operation) — no `errno` number, no `syscall`, no `dest` — and `reason.syscall` is never set on an Effect failure; only `syncFileSystem`'s thrown errors carry `syscall`. Kept divergences: `copy` without `overwrite` fails `AlreadyExists` (node keeps the destination silently), `copy` does not create a missing destination parent, and a read-only `open` of a directory fails at `open` rather than at the first read.
- Relative paths resolve from the virtual root `/` — the `FileSystem` contract has no working-directory operation.
- `access` checks existence only; its `readable`/`writable`/`ok` options are deliberately ignored (the volume models no process identity).
- **Sizes are `ByteSize`, seeks are `bigint`, and a seek before the start fails.** `FileSystem.Size`/`SizeInput` do not exist — `File.Info.size` is a `ByteSize.ByteSize` — read it with `ByteSize.toNumberUnsafe`/`toBigInt`, never `Number(info.size)` — and `File.seek(offset: bigint, from)` returns the new `bigint` position. memfs matches Node's `platform-node-shared` here: a seek whose resulting position would be negative fails `BadArgument` ("Cannot seek before the start of the file") and leaves the cursor unchanged. `read`/`write` return a plain `number`; `readAlloc`/`truncate` take one.
- The engine is a vendored port of Effect-TS/effect PR #6573 (pinned `c0528bd5`) with PR #6555's conformance suite, run against both the memory volume and `@effect/platform-node`'s real filesystem as a differential oracle — with a planned **sunset when core ships its own** in-memory `FileSystem`. Do not "deduplicate" its embedded mini-glob with `@effected/glob`; the zero-edges law forbids the import.
