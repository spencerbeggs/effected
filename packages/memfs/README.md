# @effected/memfs

[![npm](https://img.shields.io/npm/v/@effected%2Fmemfs?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/memfs)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

In-memory implementation of Effect's `FileSystem` service: an isolated virtual POSIX volume — files, directories, symlinks, hard links, open descriptors, temp resources, globbing, watching — behind the standard `FileSystem.FileSystem` key. Provide `MemoryFileSystem.layer` (or `layerWith` a seed) in place of a host-backed filesystem and any program requiring `FileSystem` runs against it unchanged.

The founding contract is honest absence: reading a path nothing seeded fails typed with `NotFound` — it never fabricates content.

> **Pre-release.** This package is part of the `@effected/*` kit, in pre-`1.0.0`
> development against a single pinned Effect v4 prerelease. Packages graduate to
> `1.0.0` once Effect `4.0.0` ships. To hold your own `effect` versions at
> exactly the ones the kit is built and tested against, install
> [`@effected/pnpm-plugin-effect`](https://www.npmjs.com/package/@effected/pnpm-plugin-effect).
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version — even a
> package marked *stable* before `1.0.0` can introduce a breaking change by
> accident, and an exact pin turns that into a type-check error rather than a
> runtime surprise. Full policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Install

```bash
npm install --save-dev @effected/memfs effect
```

```bash
pnpm add -D @effected/memfs effect
```

Requires Node.js >=24.11.0. `effect` v4 is a peer dependency; the package itself adds no other runtime dependencies. A dev dependency is the usual placement, since the volume is most often a test double — install it as a regular dependency when a shipped dry-run mode runs a program against it.

All `@effected/*` packages are ESM-only: the exports maps publish only `import` conditions, so `require()` — including tools that resolve in CJS mode — fails with Node's `ERR_PACKAGE_PATH_NOT_EXPORTED` rather than loading a CJS build that does not exist. Import from an ES module.

## Seeding

A seed maps absolute paths to entries. Plain `string`/`Uint8Array` values are file contents; the tagged helpers let one literal describe a whole tree — empty directories, symlinks, and initial permission modes:

```ts
const Volume = MemoryFileSystem.layerWith({
  "/repo/package.json": `{ "name": "fixture" }`,
  "/repo/tools/build.sh": MemoryFileSystem.file("#!/bin/sh\n", { mode: 0o755 }),
  "/repo/.cache": MemoryFileSystem.directory(),
  "/repo/latest": MemoryFileSystem.symlink("/repo/package.json"),
});
```

Seeded entries all take the volume's clock at seed time, so a seed alone cannot express "this file is older than that one". `MemoryFileSystem.file(content, { mtime })` pins an entry's modification time in epoch milliseconds, which is what a test needs to exercise a signature or cache-invalidation scheme that fingerprints a tree by modification time. Two traps come with it: the volume stamps writes from the Effect `Clock`, so under `it.effect` every write lands at the epoch until `TestClock` is advanced, and `FileSystem.utimes` reads a bare number as Unix *seconds*, so pass a `Date` when you mean milliseconds.

Layer memoization is per-build: every `Effect.provide` of a layer value — even the same bound `const` — builds and re-seeds a fresh volume. To share one volume across several effects, run them under a single provide of one composed layer graph (e.g. `Layer.provideMerge` to expose both the service under test and `FileSystem`). `Layer.fresh`'s only role is giving one consumer *inside* that graph its own volume — across separate provides there is nothing to isolate.

## Inspecting a volume

`MemoryFileSystem.layerInspectableWith(seed)` provides the `FileSystem` service and a `MemoryFileSystem.Volume` view over the same volume, so a test asserts on what a program *wrote* without routing every assertion back through an `Effect` read. The view is synchronous, read-only and live: it reads the volume's state at call time, so a read after a write observes the write and a removal disappears.

```ts
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, FileSystem } from "effect";

const Volume = MemoryFileSystem.layerInspectableWith({
  "/repo/package.json": `{ "name": "root" }`,
  "/repo/packages": MemoryFileSystem.directory(),
});

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.writeFileString("/repo/packages/a.json", "{}");

  const volume = yield* MemoryFileSystem.Volume;
  volume.readDirectory("/repo");
  // ["package.json", "packages"] — names, sorted, not paths
  volume.readDirectory("/repo/packages");
  // ["a.json"] — the write is visible immediately
  volume.isDirectory("/repo/packages");
  // true
  volume.text("/repo/nothing.json");
  // undefined — nothing there, never ""
});
```

`snapshot()`, `text(path)`, `bytes(path)`, `has(path)` and `paths()` cover file contents; `readDirectory(path)`, `isDirectory(path)` and `mtime(path)` cover structure and timing. All of them are **literal**: a symbolic link is listed by its own name and never followed, so a link pointing at a directory answers `isDirectory` with `false` — a deliberate divergence from `statSync(p).isDirectory()`, which resolves the link first.

Absence is reported as `undefined` rather than an empty value, and the distinction is the point: `[]` is a genuinely empty directory, `0` is a file modified at the epoch, and a signature built over mtimes must not read an absent file as one modified in 1970.

## The synchronous port

Some code takes an injected sync filesystem port instead of requiring `FileSystem` — a config-time hook that cannot await is the usual reason. `MemoryFileSystem.syncFileSystem(volume)` adapts the inspection view to the `node:fs` sync subset those ports ask for (`exists`, `readFile`, `readDirectory`, `isDirectory`). A pure function over a volume: no service, no layer, no `Effect`.

```ts
const program = Effect.gen(function* () {
  const { volume } = yield* MemoryFileSystem.makeInspectableWith({
    "/repo/package.json": `{ "name": "root" }`,
    "/repo/packages": MemoryFileSystem.directory(),
  });

  const sync = MemoryFileSystem.syncFileSystem(volume);
  sync.readDirectory("/repo");
  // ["package.json", "packages"]
  sync.readFile("/repo/nothing.json");
  // throws: ENOENT, with code/syscall/path on the error
});
```

The shape is structural, so `@effected/workspaces`' `SyncFileSystem` — and anything else asking for those four operations — is satisfied with neither package importing the other.

Absence throws, because a synchronous non-`Effect` signature has no other failure channel. The thrown error carries `code`, `syscall` and `path`, matching what the `node:fs` binding would raise, so a consumer written against the builtin reads it unchanged. It is never papered over with `""` or `[]`.

This is deliberately not a general escape hatch from the `FileSystem` service. Code that calls `node:fs` directly still does not see the volume; only code that accepts an injected port does. Where the call site can be changed, taking `FileSystem` from the environment remains the better answer, and it buys typed errors and the rest of the service's contract along the way.

## Fault injection

`MemoryFileSystem.layerFaulty` wraps whatever `FileSystem` it is provided with — memfs the intended one — and is delegate-by-default: only registered methods are intercepted, handlers receive the real call arguments, and a handler that returns `undefined` declines, letting the call reach the wrapped volume. The opposite of `FileSystem.layerNoop`'s deny-by-default.

```ts
const Faulty = MemoryFileSystem.layerFaulty({
  chmod: (path, mode) =>
    mode === 0o555 || mode === 0o444
      ? Effect.fail(PlatformError.systemError({ _tag: "PermissionDenied", module: "FileSystem", method: "chmod", pathOrDescriptor: path }))
      : undefined,
}).pipe(Layer.provide(Volume));
```

`MemoryFileSystem.layerFaultyWith(seed, faults)` is the seeded one-step form, and `MemoryFileSystem.failTimes(n, error)` is a transient fault — fail `n` intercepted calls, then delegate — for exercising retry policies (attempts are counted per execution, so `Effect.retry` outlasts it). Every method is interceptable, `stream`/`sink`/`watch` included (their handlers return replacement Streams/Sinks; `failTimes` is confined to the Effect-returning methods at the type level), and faults on core methods also propagate into the members derived from them (`access` → `exists`, `readFile` → `readFileString`, `writeFile` → `writeFileString`, `open` → `stream`/`sink`).

## Permission modes are metadata, never enforced

Modes set by seeding, `chmod`, `makeDirectory` or `writeFile` are recorded faithfully and readable via `stat`, but no operation checks them: the volume models no process identity (no uid/gid/umask), so nothing ever fails `PermissionDenied` on its own — `access` checks existence only. To exercise a permission-failure code path, inject the failure with `layerFaulty` instead of arranging modes.

## What the volume does not see

memfs implements one thing: Effect's `FileSystem` service. It installs no hooks, patches no module registry and intercepts nothing globally, so the volume is visible to code that *asks for the service* and invisible to everything else. Four boundaries follow, and each is a property of the design rather than a gap to be closed:

- **Direct `node:fs` and `node:fs/promises` calls.** Code that imports the Node builtin reads and writes the real host filesystem, in the same process, while a volume sits unused beside it. No adapter changes that, deliberately: a filesystem-shaped facade would legitimize the bypass and grow a second, weaker sanctioned path. Bring such code under a volume by taking `FileSystem` from the environment, or by having it accept an injected port and passing it `syncFileSystem`.
- **Anything a child process does.** A spawned command gets the host filesystem; nothing the parent provided travels across the process boundary. Test the command-running seam with a `ChildProcessSpawner` double, not with a volume.
- **Native-binding IO.** A native module that opens files through its own bindings — SQLite via `@effect/sql-sqlite-node` being the usual case — never touches the service, so a volume does nothing for it. Use an in-memory database (`:memory:`) for that shape of test; it is the right tool, not a workaround.
- **The current working directory.** The volume models no process cwd. Relative paths resolve from the virtual root `/`, so `"tmp/x"` means `/tmp/x` here and something else on a host filesystem. Seed and address paths absolutely, and pass the base directory into code under test rather than letting it read `process.cwd()`, which leaves the volume's model silently.

## Credits

The engine is a vendored port with attribution of unmerged upstream work, MIT (Effectful Technologies Inc.):

- [Effect-TS/effect#6573](https://github.com/Effect-TS/effect/pull/6573) — `MemoryFileSystem` by lloydrichards, on [fubhy's effect-smol#456 design](https://github.com/Effect-TS/effect-smol/pull/456) (engine, pinned at `c0528bd5`).
- [Effect-TS/effect#6555](https://github.com/Effect-TS/effect/pull/6555) — the parameterized `FileSystem` conformance suite (pinned at `2492ba9d`).

This package is not deprecated. When upstream ships its own `MemoryFileSystem` module in core `effect`, the release that adopts it will deprecate this package in core's favor — the module name matches upstream so that migration is an import-path change.

## License

[MIT](LICENSE)
