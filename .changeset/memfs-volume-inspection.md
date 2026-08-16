---
"@effected/memfs": minor
---

## Features

### Volume inspection for write-path test assertions

`MemoryFileSystem.layerInspectable` and `layerInspectableWith(seed)` provide the standard `FileSystem` service together with a new `MemoryFileSystem.Volume` service inspecting the same volume instance — within one build, a write through the filesystem is immediately visible to the volume view. The existing constructors are unchanged and never carry the extra service.

`Volume` exposes pure synchronous reads over live state — `snapshot()` (every regular file as path → bytes), `text(path)`, `bytes(path)`, `has(path)` and `paths()` — so an assertion reads content back without threading an Effect. Honest absence carries to the sync view: `text`/`bytes` answer `undefined` for a path holding no regular file, and `""` only ever means a genuinely empty file. Symbolic links are never followed in the view; returned byte arrays are defensive copies.

`makeInspectable` and `makeInspectableWith(seed)` build the `{ fileSystem, volume }` pair value-level — the form for tests that assert after the effect runs: build the pair once, wrap the filesystem in `Layer.succeed` (optionally decorated by `makeFaulty` first), and let assertions read the pinned volume. To inspect under fault injection at the layer level, compose `layerFaulty(faults).pipe(Layer.provideMerge(inspectable))`.

## Documentation

* `layerFaulty` now points at `layerFaultyWith({}, faults)` for the no-seed case (which needs no base `FileSystem` in `R`) and documents delegate-by-default as a supported spy pattern
