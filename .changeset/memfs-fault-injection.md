---
"@effected/memfs": minor
---

## Features

### Fault injection over a real volume

`MemoryFileSystem.layerFaulty(faults)` wraps whatever `FileSystem` is provided beneath it — compose as `layerFaulty({...}).pipe(Layer.provide(volume))` — and delegates every call by default: a handler returning `undefined` falls through to the real filesystem, so a test names only the operation it wants to fail while everything else runs against the volume. Handlers receive the real call arguments, letting predicates key on path or mode, and injected faults are type-constrained to each method's own `PlatformError` channel, so a bare `Error` does not compile.

Every function member of the `FileSystem` service is interceptable, including the derived members (`exists`, `readFileString`, `writeFileString`, `stream`, `sink`) — a fault on a core method like `open` or `readFile` propagates coherently into the members derived from it, and each derived member also intercepts directly. `makeFaulty(base, faults)` is the pure wrapper over any filesystem value; `layerFaultyWith(seed, faults)` combines seeding and faults in one layer.

### Transient faults

`MemoryFileSystem.failTimes(times, error)` fails the first `times` executions of a method, then delegates forever — the shape a retry-policy test needs. Dispatch is per execution, so `Effect.retry` attempts consume failures; counters arm per volume build, so `Layer.fresh` re-arms them.

### Seeds for directories, symlinks and modes

Seed entries widen beyond file contents: `MemoryFileSystem.directory({ mode })` expresses an empty directory, `MemoryFileSystem.symlink(target)` a symlink (dangling targets allowed), and `MemoryFileSystem.file(content, { mode })` a file with an initial mode — one seed literal describes a whole tree. Plain `string`/`Uint8Array` entries behave exactly as before.

## Documentation

* States explicitly that permission modes are recorded and readable via `stat` but never enforced on any operation; fault injection is the intended way to exercise permission-failure paths
* Corrects the `layerWith` memoization guidance: volume sharing is per build, not per layer value — two separate `Effect.provide` calls re-seed independently; sharing a volume across effects takes one provide over one composed program, and `Layer.fresh` isolates consumers within a single build graph
