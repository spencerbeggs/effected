---
type: Convention
title: Module layout is module-per-concept, not kind-based folders
description: Structure every package's src/ as one file per public concept rather than as errors/, schemas/, services/, layers/ folders.
status: stable
stale_after: "2027-03-13T00:00:00Z"
tags:
  - architecture
  - dx
sources:
  - id: config-file-src
    resource: ../../packages/config-file/src
  - id: memfs-fs
    resource: ../../packages/memfs/src/MemoryFileSystem.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-30T01:39:09Z
  body_sha256: e55e59088f8ea0b3ce51bb00b09ee49e2e70546b124d1a6361e044b5fb16486a
---

# Module layout is module-per-concept, not kind-based folders

Every `@effected/*` package structures `src/` around one file per public
concept, never around a kind of artifact. Kind-based folders — `errors/`,
`schemas/`, `services/`, `layers/`, `utils/` — scatter one concept's parts
across several directories and force verbose disambiguation suffixes to
tell the pieces apart once they are separated.

## The layout

- `src/index.ts` — the public surface, re-exports only. See
  [no barrel re-exports](no-barrel-re-exports.md) for what else is and is
  not allowed to live there.
- `src/<Concept>.ts` — one PascalCase file per public concept (for example
  `SemVer.ts`, `Range.ts`, `ConfigCodec.ts`). The file owns everything that
  concept needs: its `Schema.Class` domain model(s) with static and
  instance methods, the `Schema.TaggedError`s that concept raises, and —
  when the concept is a service — the `Context.Service` class plus its
  layer(s) in the same file.[^config-file-src]
- `src/internal/` — private implementation helpers, never exported from
  `index.ts`.

`@effected/config-file`'s `src/` is a working example of the shape at
scale: `ConfigFile.ts`, `ConfigCodec.ts`, `ConfigResolver.ts`,
`ConfigMigration.ts`, `ConfigEvent.ts` and the four codec files each own
their own errors and, where relevant, their own service and layer,
alongside `internal/` for what none of that is public.

## Why the file name carries the API name

The file name IS the public name it exports, which eliminates the
disambiguation suffixes a kind-based layout forces once the parts of one
concept are separated into different folders — no `SemVerParserLive.ts`,
no one-class `InvalidVersionError.ts` file, no `utils/` folder of floating
functions that should have been statics or instance methods on a schema
class instead. `@effected/memfs`'s `MemoryFileSystem.ts` shows the same
discipline for a service: the class, its errors, and its several layer
constructors (`layer`, `layerWith`, `makeHandle`, and others) all live in the one
file the concept is named for.[^memfs-fs]

## Never author a new kind-based folder

Adding an `errors/`, `schemas/`, `services/` or `layers/` folder to a
package's `src/` is a regression to the superseded layout, even if the
new folder holds only one file today. Put the new concept's file directly
under `src/` instead, named for the concept, and let it own its own
errors and layer.

[^config-file-src]: `packages/config-file/src/` — `ConfigCodec.ts`,
    `ConfigEvent.ts`, `ConfigFile.ts`, `ConfigResolver.ts`, the four
    codec modules.
[^memfs-fs]: `packages/memfs/src/MemoryFileSystem.ts` — the class, its
    errors, and its `layer`/`layerWith` family in one module.
