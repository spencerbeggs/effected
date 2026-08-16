# @effected/memfs

## 0.2.0

### Features

* ### Fault injection over a real volume

  `MemoryFileSystem.layerFaulty(faults)` wraps whatever `FileSystem` is provided beneath it — compose as `layerFaulty({...}).pipe(Layer.provide(volume))` — and delegates every call by default: a handler returning `undefined` falls through to the real filesystem, so a test names only the operation it wants to fail while everything else runs against the volume. Handlers receive the real call arguments, letting predicates key on path or mode, and injected faults are type-constrained to each method's own `PlatformError` channel, so a bare `Error` does not compile.

  Every function member of the `FileSystem` service is interceptable, including the derived members (`exists`, `readFileString`, `writeFileString`, `stream`, `sink`) — a fault on a core method like `open` or `readFile` propagates coherently into the members derived from it, and each derived member also intercepts directly. `makeFaulty(base, faults)` is the pure wrapper over any filesystem value; `layerFaultyWith(seed, faults)` combines seeding and faults in one layer.

  ### Transient faults

  `MemoryFileSystem.failTimes(times, error)` fails the first `times` executions of a method, then delegates forever — the shape a retry-policy test needs. Dispatch is per execution, so `Effect.retry` attempts consume failures; counters arm per volume build, so `Layer.fresh` re-arms them.

  ### Seeds for directories, symlinks and modes

  Seed entries widen beyond file contents: `MemoryFileSystem.directory({ mode })` expresses an empty directory, `MemoryFileSystem.symlink(target)` a symlink (dangling targets allowed), and `MemoryFileSystem.file(content, { mode })` a file with an initial mode — one seed literal describes a whole tree. Plain `string`/`Uint8Array` entries behave exactly as before.

### Documentation

* States explicitly that permission modes are recorded and readable via `stat` but never enforced on any operation; fault injection is the intended way to exercise permission-failure paths
* Corrects the `layerWith` memoization guidance: volume sharing is per build, not per layer value — two separate `Effect.provide` calls re-seed independently; sharing a volume across effects takes one provide over one composed program, and `Layer.fresh` isolates consumers within a single build graph [#382][#382]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#382]: https://github.com/spencerbeggs/effected/pull/382

## 0.1.0

### Features

* ### `@effected/memfs` — an in-memory `FileSystem`

  First release. `MemoryFileSystem` is an in-memory implementation of core Effect's `FileSystem` service: an isolated virtual POSIX volume — files, directories, symlinks, hard links, open descriptors, globbing, watching — behind the standard `FileSystem.FileSystem` key, for tests and dry-run programs that need filesystem behavior without host filesystem IO.

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

  `MemoryFileSystem.layer` / `.make` build an empty volume; `.layerWith(seed)` / `.makeWith(seed)` pre-populate one from a `path → content` map. The founding contract is **honest absence**: reading, statting, or opening (without a create flag) a path nothing seeded fails typed with a `NotFound` `SystemError` — the volume never fabricates content.

  The engine is a vendored port, with attribution, of Effect-TS/effect PR #6573 (pinned `c0528bd5`) and the conformance suite of PR #6555 — carrying a documented sunset for whenever core ships its own in-memory backend. It has zero `@effected/*` dependencies (`effect` is the only peer), so any package in the kit — this one included — can devDepend on it for tests without creating a cycle. [#366][#366]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#366]: https://github.com/spencerbeggs/effected/pull/366
