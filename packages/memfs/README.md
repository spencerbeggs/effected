# @effected/memfs

In-memory implementation of Effect's `FileSystem` service: an isolated virtual POSIX volume — files, directories, symlinks, hard links, open descriptors, temp resources, globbing, watching — behind the standard `FileSystem.FileSystem` key. Provide `MemoryFileSystem.layer` (or `layerWith` a seed) in place of a host-backed filesystem and any program requiring `FileSystem` runs against it unchanged.

The founding contract is honest absence: reading a path nothing seeded fails typed with `NotFound` — it never fabricates content.

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

Layer memoization is per-build: every `Effect.provide` of a layer value — even the same bound `const` — builds and re-seeds a fresh volume. To share one volume across several effects, run them under a single provide of one composed layer graph (e.g. `Layer.provideMerge` to expose both the service under test and `FileSystem`). `Layer.fresh`'s only role is giving one consumer *inside* that graph its own volume — across separate provides there is nothing to isolate.

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

## Credits

The engine is a vendored port with attribution of unmerged upstream work, MIT (Effectful Technologies Inc.):

- [Effect-TS/effect#6573](https://github.com/Effect-TS/effect/pull/6573) — `MemoryFileSystem` by lloydrichards, on [fubhy's effect-smol#456 design](https://github.com/Effect-TS/effect-smol/pull/456) (engine, pinned at `c0528bd5`).
- [Effect-TS/effect#6555](https://github.com/Effect-TS/effect/pull/6555) — the parameterized `FileSystem` conformance suite (pinned at `2492ba9d`).

This package is not deprecated. When upstream ships its own `MemoryFileSystem` module in core `effect`, the release that adopts it will deprecate this package in core's favor — the module name matches upstream so that migration is an import-path change.
