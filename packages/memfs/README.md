# @effected/memfs

In-memory implementation of Effect's `FileSystem` service: an isolated virtual POSIX volume — files, directories, symlinks, hard links, open descriptors, temp resources, globbing, watching — behind the standard `FileSystem.FileSystem` key. Provide `MemoryFileSystem.layer` (or `layerWith` a `path → content` seed) in place of a host-backed filesystem and any program requiring `FileSystem` runs against it unchanged.

The founding contract is honest absence: reading a path nothing seeded fails typed with `NotFound` — it never fabricates content.

## Credits

The engine is a vendored port with attribution of unmerged upstream work, MIT (Effectful Technologies Inc.):

- [Effect-TS/effect#6573](https://github.com/Effect-TS/effect/pull/6573) — `MemoryFileSystem` by lloydrichards, on [fubhy's effect-smol#456 design](https://github.com/Effect-TS/effect-smol/pull/456) (engine, pinned at `c0528bd5`).
- [Effect-TS/effect#6555](https://github.com/Effect-TS/effect/pull/6555) — the parameterized `FileSystem` conformance suite (pinned at `2492ba9d`).

This package is not deprecated. When upstream ships its own `MemoryFileSystem` module in core `effect`, the release that adopts it will deprecate this package in core's favor — the module name matches upstream so that migration is an import-path change.
