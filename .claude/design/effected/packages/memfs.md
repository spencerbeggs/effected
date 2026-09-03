---
status: current
module: effected
category: architecture
created: 2026-08-14
updated: 2026-09-02
last-synced: 2026-09-02
completeness: 92
related:
  - ../effect-standards.md
  - ../package-inventory.md
  - ../package-setup.md
  - ../migration-playbook.md
  - glob.md
  - workspaces.md
  - github-actions-runtime.md
  - templates.md
  - jsonl.md
---

# @effected/memfs design

## Overview

`@effected/memfs` is an in-memory implementation of core Effect's `FileSystem` service: an isolated virtual POSIX volume — files, directories, symlinks, hard links, open descriptors, temp resources, globbing, watching — behind the standard `FileSystem.FileSystem` key, so any program or test that requires `FileSystem` in `R` runs against it unchanged. It exists because core ships only `FileSystem.layerNoop`, which is deny-by-default, so every hand stub encodes only what its author remembered; one such stub answered an unarranged read with `""` instead of failing and caused a silent-changeset-drop bug downstream (effected#249).

The founding contract is **honest absence**: a read of a path nothing seeded fails typed (`SystemError` reason `NotFound`), never fabricates content. It recurs three times in this design — in the service, in the [inspection view](#volume-inspection) and in [the sync port](#the-sync-filesystem-port) — and each recurrence is deliberate.

## The vendored port

The engine is a **port with attribution** of two unmerged upstream contributions, pinned by SHA:

- **Engine**: Effect-TS/effect PR [#6573](https://github.com/Effect-TS/effect/pull/6573) "feat: add MemoryFileSystem module" by **lloydrichards**, built on **fubhy**'s design in effect-smol [#456](https://github.com/Effect-TS/effect-smol/pull/456). Pinned head: `c0528bd5cf12154aa95a7ceec243fd2045876853`. MIT, Effectful Technologies Inc.
- **Conformance suite**: Effect-TS/effect PR [#6555](https://github.com/Effect-TS/effect/pull/6555) "test: add file system test suite" (`FileSystemTest.ts`, a contract suite parameterized over any `Layer<FileSystem, unknown>`), same author. Pinned head: `2492ba9df1c0fd25a2119aace82dafb2b7b8e77c`.

Vendored rather than waited-for because both PRs have sat unmerged for months and are not queued; the kit needs the capability now. **Sunset clause**: the release in which core's `effect` ships a `MemoryFileSystem` module, this package is deprecated in favor of it — the module name `MemoryFileSystem` deliberately mirrors upstream so the migration is an import-path change.

The pins are the anti-drift record: re-evaluating against a newer upstream head is a deliberate re-vendor with this doc updated, never an in-place edit. Every deliberate delta is listed in [the adaptation ledger](#adaptation-ledger); anything else that diverges from `c0528bd5` is drift, not design.

## Tier and dependencies

**Pure tier.** The package performs no host IO — the volume is immutable in-memory state (`HashMap`-backed inode table) behind a one-permit semaphore — and it *provides* `FileSystem` rather than requiring anything: the layer's `R` is `never`. `effect` is the only peer; zero runtime dependencies ([R1](../effect-standards.md#dependency-policy)).

**The zero-edges law: no `@effected/*` edge, ever — runtime, peer or dev.** The package's whole purpose is to be the filesystem double every kit package's tests consume as a devDependency, [`@effected/glob`](glob.md) included. Any edge from `memfs` back into the kit creates the cycle that law exists to prevent. Its one structural consequence: the engine **keeps the upstream mini-glob** (brace expansion, character classes, globstar) for the `FileSystem.glob` member, a deliberate duplication of capability `@effected/glob` also ships. Do not "deduplicate" by importing `@effected/glob`; the duplication is the price of the law, and the mini-glob serves only `fs.glob`, never a public matching API.

`@effect/platform-node` (`catalog:effect`) is a **devDependency only**, confined to the differential-oracle integration test.

A new package rather than a fold-in, because every candidate host inverts the law or misses the domain: `glob` would have to be depended on *by* its own test double, `walker` and `xdg` and `commands` are the wrong domains, and `store` is both wrong-domain and integrated tier. A test-support leaf that everything may devDepend on and that depends on nothing is the only shape without cycles. The name is the domain noun; the scope prevents collision with the unscoped `memfs` package, and the public module is `MemoryFileSystem` for upstream parity.

## Public surface

One module. It provides core's `FileSystem` service; the one service it declares of its own — `MemoryFileSystem.Volume` — is opt-in and published by the inspectable constructors only.

- `MemoryFileSystem.make` / `MemoryFileSystem.layer` — a fresh empty volume, as an `Effect` and as a `Layer` (fresh per build).
- `MemoryFileSystem.makeWith(seed)` / `layerWith(seed)` — a fresh volume pre-populated from a `path → MemoryFileSystemSeedEntry` record; parent directories are created recursively, then each entry applied in the record's own key order. The seeding record is the ergonomic replacement for hand-stubbed `layerNoop` tree fixtures.

The layer forms are **parameterized factories**: each call mints a fresh reference, so bind the result to a `const` rather than calling it at each composition site. A contradictory seed **dies** in `layerWith` (wiring-bug posture); `makeWith` is the form that keeps seeding failures in the error channel.

### Seed entries

A seed value is a `MemoryFileSystemSeedEntry`: plain `string | Uint8Array` contents or one of three tagged entries built by statics — `file(content, { mode?, mtime? })`, `directory({ mode? })`, `symlink(target)`. One seed literal therefore describes a whole tree: files with initial modes (`0o644` default), *empty* directories (the only way a seed can express one) with modes (`0o755` default), and symbolic links whose target is stored verbatim and may dangle. A directory's mode is applied by a post-`makeDirectory` `chmod` so it lands even when that directory already exists — created implicitly as an earlier entry's parent.

`file`'s `mtime` pins a modification time in epoch milliseconds. Without it every seeded entry takes the volume's clock at seed time, so a seed alone cannot express "this file is older than that one" — which is exactly what a consumer fingerprinting a tree by mtime needs to test. Only `file` takes the option; a pinned directory or symlink time waits for a consumer that needs one. The two unit traps it sits between are recorded in [ledger entry 9](#adaptation-ledger), because each produces a wrong *time* rather than an error.

### Fault injection

A **delegate-by-default** wrapper over any `FileSystem`:

- `MemoryFileSystem.makeFaulty(base, faults)` — the pure core: a wrapped `FileSystem` value, no Effect, no layer.
- `MemoryFileSystem.layerFaulty(faults)` — `Layer<FileSystem, never, FileSystem>`: it *requires* the filesystem it wraps, so the composition is `layerFaulty({...}).pipe(Layer.provide(volume))` and the wrapped implementation need not be this package's.
- `MemoryFileSystem.layerFaultyWith(seed, faults)` — the self-contained convenience form.
- `MemoryFileSystem.failTimes(times, error)` — a transient fault: the first `times` intercepted calls fail with `error`, then delegation resumes forever.

The design decisions worth keeping:

- **`undefined` delegates.** A handler that returns nothing declines, and unregistered methods are never intercepted at all. This is the deliberate inverse of `FileSystem.layerNoop`'s deny-by-default, which forces a consumer wanting one failing `chmod` to hand-build every other method the code path touches — and paying `readDirectory: () => Effect.succeed([])` means the recursion the test existed to prove never happens.
- **Handlers receive the real call arguments**, so a fault keys on the path or the mode of one specific call — distinguishing an unlock pass from a relock pass inside a single walk, say.
- **Faults are type-constrained to each method's own channel.** `MemoryFileSystemFaultHandler` returns the method's own return type, so an injected failure must be a genuine `PlatformError`; `Effect.fail(new Error(...))` does not compile. A test named for the `PlatformError` channel that fails with a bare `Error` never exercises it — exactly the silent fiction this package exists to kill.
- **Every function-valued member is interceptable** (`MemoryFileSystemFaultMethod` is derived, not enumerated by hand). The wrapper rebuilds the service through `FileSystem.make` over the primitive members, so a fault on a core method propagates coherently into the members `make` derives (`access` → `exists`, `readFile` → `readFileString`, `writeFile` → `writeFileString`, `open` → `stream`/`sink`) — as an OS failure would. Those derived members are then **re-intercepted on top of the rebuilt service**, so each also remains directly interceptable. Without that second pass a fault registered on `readFileString` would be silently discarded by the re-derivation from an unfaulted `readFile` — a green test proving nothing.
- **Effect-returning methods dispatch per execution** through `Effect.suspend`: a retried effect re-consults its handler, which is what lets `Effect.retry` attempts consume `failTimes` counts rather than one invocation consuming one. `watch`, `stream` and `sink` return `Stream`/`Sink` values and are handler-form only, consulted at invocation.
- **`failTimes` counters are armed per build**, not per fault value: each `makeFaulty` call and each layer build starts a fresh countdown, and `Layer.fresh` re-arms. `failTimes` **throws `RangeError`** on a negative or non-integer `times` — misuse is a wiring bug, the same posture as `layerWith`'s die on a contradictory seed.

### Volume inspection

The write-path counterpart to seeding: a synchronous, read-only view of the same volume the `FileSystem` writes to, so a test asserts on what a program *wrote* without routing every assertion through an `Effect` read.

- `MemoryFileSystem.Volume` — the context key, `Context.Service("@effected/memfs/MemoryFileSystemVolume")` in **function form**, the interface serving as both identifier and shape. This deliberately copies `FileSystem.FileSystem`'s own key pattern rather than the kit's class-form convention: the module mirrors upstream so the sunset clause is an import-path change, and a service shaped unlike its upstream neighbor would be the first thing to rewrite on acceptance.
- `MemoryFileSystemVolume` — the view: `snapshot()`, `text`, `bytes`, `has`, `paths`, `readDirectory`, `isDirectory` and `mtime`. Pure sync functions over the volume's **live state at call time** — never a copy taken at build — so a read after a write observes the write, and a removal disappears. Returned byte arrays are defensive copies; mutating one cannot corrupt the volume.
- `MemoryFileSystem.makeInspectable` / `makeInspectableWith(seed)` — the value-level pair `{ fileSystem, volume }` over one volume. The seeded form **fails typed**, keeping seeding failures in the error channel.
- `MemoryFileSystem.layerInspectable` / `layerInspectableWith(seed)` — `Layer<FileSystem.FileSystem | MemoryFileSystemVolume>`, both services from one volume per build. The seeded form **dies** on a contradictory seed, the wiring-bug posture `layerWith` already sets.

The design decisions worth keeping:

- **Opt-in, so no existing type widened.** `layer`, `layerWith` and `layerFaulty*` still provide `FileSystem` and nothing else; consumers annotating `Layer.Layer<FileSystem.FileSystem>` keep compiling. A test pins this by *annotating* `layer` and `layerWith(...)` at exactly that type — widening either would stop the suite compiling, so `types:check` is part of the guarantee.
- **One internal `make` per build, both services derived from it**, so the pairing invariant is structural rather than a convention two constructors have to keep: `internal.makeInspectable` returns `{ fileSystem, entries }` from a single `makeReadyVolume`, and the layer forms publish both services with `Layer.effectContext` over that **one** effect. That is the memoization-safe way to publish N services sharing an instance — two `Layer.effect`s over the same effect would build it twice and hand out two volumes wearing one name.
- **Assertion timing is the choice between the two families.** The layer forms are for tests that resolve `Volume` and assert *inside* the provided effect. When assertions run *after* it, use the make forms: build the pair once, wrap it in `Layer.succeed(FileSystem.FileSystem, pair.fileSystem)` (optionally decorated by `makeFaulty` first), and assert on `pair.volume` — the identity is pinned, where a layer form would build and re-seed a fresh pair per provide and the post-run assertion would read a volume nobody wrote to. The [`@effected/templates`](templates.md) fixture is the worked consumer example, composing `makeFaulty` over the pair's `fileSystem`. At the layer level the same composition is `layerFaulty(faults).pipe(Layer.provideMerge(inspectable))` — `provideMerge` so the decorated `FileSystem` wins the key while `Volume` survives.

The view's semantics are documented, not incidental:

- **Regular files only** in `snapshot`/`paths`; directories and symbolic links never appear. `paths()` is exactly `snapshot()`'s key set, sorted lexicographically.
- **Symlinks are never followed anywhere in the view.** `has` sees the link itself (its target unconsulted, dangling allowed); `text`/`bytes` answer `undefined` for it, because reading *through* a link is the `FileSystem` API's job. The view is literal by design — following links here would make an inspection read silently disagree with the tree it claims to describe. `isDirectory` is literal for the same reason: a symbolic link *pointing at* a directory answers `false`, a deliberate divergence from `statSync(p).isDirectory()`.
- **Hard links fan out**: one entry per directory entry, each path carrying the same content.
- **Query paths normalize lexically only** (`//`, `.`, `..` and relative paths resolving from `/` as the engine does) — normalization never touches the filesystem, so it cannot follow a link either.
- **Absence is always `undefined`, never a plausible empty value.** `text`/`bytes` answer `undefined` for a path holding no regular file, so `""` only ever means a genuinely empty file; `readDirectory` answers `undefined` rather than `[]`, and `mtime` `undefined` rather than `0`, because a genuinely empty directory and a file modified at the epoch are real values a caller must be able to tell apart from absence. `readDirectory` reports names, not paths, as `readdir` does.
- **`has("/tmp")` is `true` on an unseeded volume**: the engine pre-creates the temp directory at build. `snapshot`/`paths` are unaffected, since it is a directory.

### The sync filesystem port

`MemoryFileSystem.syncFileSystem(volume)` adapts the inspection view to the four synchronous operations — `exists`, `readFile`, `readDirectory`, `isDirectory` — that a *consumer-supplied* sync filesystem port asks for. A pure function over a volume: no service, no layer, no `Effect`.

- **It satisfies [`@effected/workspaces`'s `SyncFileSystem`](workspaces.md#workspacessync--the-escape-hatch) structurally, importing nothing** — this package declares its own `MemoryFileSystemSyncFileSystem` and the two shapes simply agree. The zero-`@effected/*`-edges law forced the structural route, and the route is better than the edge would have been: anything asking for those four operations is served, not one named port.
- **Absence throws**, because a synchronous non-`Effect` signature has no other failure channel — honest absence in its third home. The error carries `code`/`syscall`/`path` so a consumer written against the `node:fs` binding reads it unchanged. Answering `""` or `[]` instead would be the #249 fabrication in a new costume.
- **It follows symbolic links, and the view underneath does not.** The two contracts differ on purpose: an inspection view is literal because it describes the tree as stored, while the port stands in for `stat`-defined operations, so a link to a directory IS a directory, a link reads through to its target, and a dangling link is absent as `existsSync` reports it. A literal port makes a symlinked package directory invisible to `getWorkspacePackagesSync`, so one workspace enumerates to two different package lists depending on which sanctioned backend supplied the port — precisely the failure the dirent fast path in `workspaces` re-resolves links to avoid, reached through the test double instead of through the optimization. Resolution is per path component with an `ELOOP`-style hop cap; a cycle resolves to absence.
- **It is not an escape hatch from the service.** Code calling `node:fs` directly still does not see the volume; only code accepting an injected port does. The request arrived as an `fs.promises`-shaped facade and was declined in that form: a filesystem-shaped facade legitimizes the bypass and grows a second, weaker sanctioned path, where a port adapter only serves call sites that already inject.

## What the volume does not see

memfs implements one thing — core's `FileSystem` service. It installs no hooks, patches no module registry and intercepts nothing globally, so the volume is visible to code that *asks for the service* and invisible to everything else. Four consequences, each a property of that decision rather than a gap to close: a direct `node:fs` call reads and writes the host filesystem in the same process; a spawned child process gets the host filesystem, so a command seam is tested with a `ChildProcessSpawner` double instead; native-binding IO — SQLite through `@effect/sql-sqlite-node` being the usual case — never reaches the service, so an in-memory database is the right tool there; and the volume models no process cwd, so code consulting `process.cwd()` internally silently leaves the volume's model while nothing fails loudly. The README states all four for consumers. The design point here is that **no adapter will be offered to close any of them**, for the reason given under [the sync port](#the-sync-filesystem-port).

## Internals

Internal engine in `src/internal/volume.ts` (adapted from upstream's `internal/memoryFileSystem.ts`); `src/MemoryFileSystem.ts` is the facade carrying the kit extensions; `src/index.ts` is the only re-exporting module.

## Behavioral contracts

- **Honest absence** — the #249 contract: reading, statting or opening (without a create flag) any unseeded path fails typed with reason `NotFound`; nothing in the package can fabricate content for a path nothing arranged.
- **Error normalization**: every failure is core's `PlatformError` — `systemError` with a truthful `_tag`/`method`/`pathOrDescriptor`, or `badArgument` for malformed caller input. Malformed input **never defects**. The only `Effect.die` sites are genuine internal-invariant violations inherited from upstream.
- **Isolation**: each `make`/layer *build* is one volume. **Layer memoization is per-build, not per-value**: every `Effect.provide` of a layer value — even the same bound `const` — builds and re-seeds a fresh volume (and re-arms `failTimes` counters). Sharing one volume across several effects requires one provide of one composed layer graph; `Layer.fresh`'s only role is opting a consumer *inside* that graph back out into its own volume. Under `@effect/vitest`, `layer(...)` memoizes one build for the whole suite, so a `failTimes` fault declared there is consumed by whichever test runs first and later tests silently see it exhausted.
- **Modes are metadata, never enforced.** Modes set by seeding, `chmod`, `makeDirectory` or `writeFile` are recorded faithfully and readable via `stat`, but no operation checks them: the volume models no process identity (no uid/gid/umask), so nothing ever fails `PermissionDenied` on its own — a write to a `0o444` file succeeds. This is intended rather than a gap: modeling process identity is a large feature that **fault injection replaces more cheaply**, and injecting the failure is the sanctioned way to exercise a permission-failure path. `access` ignoring its `readable`/`writable`/`ok` options is the same contract, not a separate quirk.
- **POSIX semantics** as the vendored engine defines them: bounded symlink traversal (40, exceeding → typed `BadResource`), root-clamped `..` (no escape), unlink-while-open keeps the inode until the last descriptor closes, no hard links to directories, relative paths resolve from `/` (the `FileSystem` contract has no cwd).

## Adaptation ledger

Deliberate deltas from the pinned upstream. Every delta is also recorded in the engine file's port-notes header; this is the authoritative list.

1. **`watch` honors `options?.recursive`.** Upstream's adapter ignores the `WatchOptions` parameter and infers recursion from the target being a directory; the `FileSystem` interface passes the option, so the port honors it.
2. **Recursion surfaces are depth-guarded.** Upstream recurses unbounded in `containsDirectory`, `collectInodePaths`, `cloneInode`, `detachEntry`, `validateCopyDirectoryContents` and `findBraceExpansion`; a pathological tree would stack-overflow as a defect. Guarded at `MAX_NESTING_DEPTH = 256`, failing typed — guard-consistent with the format packages ([hardening standard](../effect-standards.md)).
3. **The seeding API** (`makeWith`/`layerWith` and the `MemoryFileSystemSeedEntry` union) is a kit extension; upstream has none.
4. **`access` ignores its `readable`/`writable`/`ok` options** — inherited upstream posture, since there is no virtual process identity; kept, and stated as the general mode-non-enforcement contract rather than an `access`-local footnote.
5. Mechanical: relative `../X.ts` imports → `"effect"` package imports with `.js` extensions, house formatting, TSDoc release tags, `assert.*` in tests.
6. **Upstream bug fixed** (worth reporting on PR #6573): `copy` with `overwrite: false` onto an existing destination reported the *source* path on its `AlreadyExists` error while every sibling conflict arm reports the destination; the port reports the destination, and the vendored contract suite's conditional assertion is adjusted to match (the node adapter never enters that branch — node's `fs.cp` with `force: false` silently preserves the destination).
7. **The fault-injection API** (`makeFaulty`/`layerFaulty`/`layerFaultyWith`/`failTimes`) is a kit extension; upstream has none. It lives in the facade, never in the ported engine — it wraps *any* `FileSystem`, so re-vendoring the engine cannot disturb it, and it is the piece that would need re-homing (not deleting) if the sunset clause fires.
8. **Volume-inspection hooks** — the one kit extension that *does* reach into the ported engine, in three clearly fenced blocks (the attribution header itself is untouched):
   - `Volume.currentState()` — a synchronous read of the committed state. Safe because the engine's `State` is immutable and each transition swaps the reference under the volume's one-permit lock: a sync read observes one consistent state and can never see a half-applied transition.
   - `make` re-expressed as `makeReadyVolume` (build + pre-create `/tmp`) composed with `toFileSystem(volume)`, so the inspectable constructor derives *both* halves from one volume. The exported name and type are identical — a re-vendor re-applies the split, it does not fight it.
   - `VolumeEntrySnapshot` + `collectEntrySnapshots` (an iterative sorted DFS over the inode tree, matching the port's iterative-walker posture and its depth discipline) and the internal `InspectableFileSystem`/`makeInspectable` pair. The public view in the facade is built on top; the engine exposes no interpretation of its own.
9. **Entry modification time on the inspection snapshot** — `VolumeEntrySnapshot` carries an `mtime` field (epoch milliseconds), populated in `collectEntrySnapshots` from the inode's `mtime: DateTime.Utc` via `DateTime.toEpochMillis`. The engine tracked mtime all along and `stat` already reported it, so nothing new is computed and no transition changes — only the snapshot carries what the inode already held. `collectEntrySnapshots` also emits the **root** entry itself: a walk reporting only descendants leaves `/` in no snapshot, and `has("/")` then answers `false` for a directory that always exists. Emitting it from real inode state — rather than synthesizing a stand-in in the facade, which would have had no honest `mtime` to report — makes `has`/`isDirectory`/`readDirectory`/`mtime` uniform for `/`; `snapshot`/`paths` filter on `data` and are unaffected, and the facade's `readDirectory` excludes the queried path itself so `/` does not list itself as an empty-named child.

    Two unit traps sit around this, recorded because each silently produces wrong *times* rather than an error. First, the seed option is epoch **milliseconds** while `FileSystem.utimes` reads a bare `number` as Unix **seconds** (matching `fs.utimesSync`), so seeding converts through a `Date` — passing the number through multiplies every seeded time by 1000. Second, the volume stamps writes from the Effect `Clock`, which is what makes mtime drivable with `TestClock` — and is also why every write under `it.effect` reads as `0` unless the clock is advanced, so a seeded time appears to be in the future.

## Provenance and refusals

The kit extensions are not speculative API design: every one was requested with a blocked call site by a downstream consumer or an internal one. What is worth keeping is the **refusals**, because each is a standing decision rather than an unexplored corner:

- **An `fs.promises`-shaped facade was declined** and reshaped into [`syncFileSystem`](#the-sync-filesystem-port). Reading the downstream call sites found that the shape actually wanted was the sync port `@effected/workspaces` already defines; neither side saw that from where it was standing.
- **`seedFromDirectory` was withdrawn by the consumer** that asked for it, once its own survey found the only on-disk fixtures were subprocess-e2e trees a volume can never serve, and that every other fixture is composed inline as literals with no directory to seed *from*. It stays an [open question](#open-questions).
- **A lock module was declined as out of scope**: it is a cross-process lock exercised by two spawned processes, and a per-process volume gives a second process nothing to contend on.
- **Mode enforcement was declined** in favor of fault injection, as the [behavioral contracts](#behavioral-contracts) record.

Downstream deliberately keeps some suites on real tmpdirs, where the point is the kernel *enforcing* a mode; that is the honest boundary of what fault injection substitutes for.

## In-kit adoption

The kit packages consuming the volume in tests are [`walker`](walker.md), [`tsconfig-json`](tsconfig-json.md), [`xdg`](xdg.md) (`AppDirs`), [`workspaces`](workspaces.md), [`templates`](templates.md), [`npm`](npm.md) and [`github-actions`](github-actions.md)'s runner-file doubles. Each migration off a hand-rolled `FileSystem.layerNoop` double was mutation-checked rather than declared done on a green suite: disabling a fault handler, or swallowing a write while still counting it, has to kill tests, and in every package it did.

**The migration surfaced real defects**, which is the whole return on it:

- `tsconfig-json`'s documented file-only divergence — it probes with `exists`, which is directory-true, where tsc uses a file-only `fileExists` — was **invisible** because map membership made directories not exist. A test asserting `None` had been passing for the wrong reason. Against the volume the directory exists, the divergence is observable, and the test now pins it.
- A second `tsconfig-json` fixture had seeded a file *and* a directory at one path, a contradiction only map membership permits, and had been silently skipping its test.
- `templates` requires `FileSystem` but deliberately not `Path`, so it cannot create a parent directory — meaning "the caller guarantees the directory exists" was an untested precondition. The `Map` accepted writes into directories that did not exist; the volume refuses them.
- `github-actions`' runner-file doubles were re-implementing append (`flag: "a"`) by string concatenation — filesystem behavior hand-modelled inside the test of something else.

The pattern in all four: a stub agreed with the code under test because the same person wrote both, and the agreement read as a passing test.

**[`@effected/jsonl`](jsonl.md) is deliberately not a consumer.** Its `__test__/helpers/memfs.ts` is a **control harness**, not storage: a write gate with a vacuity guard, deterministic watch emission, a synchronous `unlink`. Migrating it would trade determinism for storage it does not need. The name collision is unfortunate and the distinction is the point — a double that exists to control *timing* is a different artifact from one that exists to hold *bytes*, and only the second is this package's job.

Not yet migrated: `schemastore`, [`app`](app.md#testing), xdg's `XdgConfig` suite and `jsonl`'s storage half.

## Test strategy: the differential oracle

Five layers of proof, largest first. See `__test__/` for the suites themselves.

1. **The vendored contract suite** (PR #6555's `FileSystemTest.ts`, adapted to house style) run against `MemoryFileSystem.layer`. It asserts `reason._tag`/`method`/`pathOrDescriptor` per operation, so it *is* the error-normalization oracle.
2. **The same suite against the real filesystem**: an integration test running the identical suite over `@effect/platform-node`'s `FileSystem` layer. Memory and disk passing one suite is the differential proof the port matches real semantics on this catalog pin — the format-package differential-oracle pattern with the platform layer as the reference implementation.
3. **Memory-specific and kit tests**: the upstream adapter tests (isolation, concurrent appends, watch events, hard-link fan-out, metadata) plus the seeding API, the honest-`NotFound` #249 contract, per-build isolation and the watch-recursive adaptation.
4. **Fault-injection tests**: the chmod-relock scenario over a real recursing tree; empty-map passthrough and unregistered-method delegation; path-keyed faults; **direct-fault coverage of every derived member**, proving none is silently bypassed by the re-derivation, alongside core-to-derived propagation; `watch` replacement *and* delegation; `failTimes` under `Effect.retry`, its per-build re-arm across two provides of one bound `const`, and `RangeError` on bad counts; and `@ts-expect-error` tests pinning the type enforcement — assertions that are only live because the package typechecks clean, so `types:check` is part of this test's proof.
5. **Volume-inspection tests**: the pairing invariant (a write through `FileSystem` is immediately visible to `Volume`, a removal likewise — the live-view claim, not a build-time copy); per-build isolation across two provides; the **no-widening type guard**, an assertion that only survives while the un-inspectable constructors stay un-widened; seed parity across every entry kind; honest absence plus the `""` round-trip that distinguishes an empty file from an absent one; lexical query normalization; the defensive-copy mutation attempt; composition under fault injection via `Layer.provideMerge`; `/` answered as a real directory rather than a hole in the walk; `undefined` distinguished from `[]` and from `0`; and the sync port throwing with `code`/`syscall`/`path` where the view answers `undefined`.

The contract suite roots every path it touches under `makeTempDirectoryScoped({ prefix: "effect-filesystem-test-" })` with no `directory` option, so the node oracle runs confined to the host's `os.tmpdir()` and never touches the repository tree.

## Attribution

The glob house pattern: `src/internal/volume.ts` opens with a `Ported from … / Copyright … / License: MIT / Port notes:` header naming both PRs, both pinned SHAs, both authors (lloydrichards; fubhy for the effect-smol#456 design), and the adaptation ledger in brief. The adapted test suite carries the same header for PR #6555. README credits both PRs. **Never edit the notice text.** Effect is MIT (Effectful Technologies Inc.), compatible with the kit's MIT license.

## Open questions

- **`seedFromDirectory`** — building a seed by reading a real directory tree. Unbuilt, and deliberately not built on the one consumer that asked, since that consumer withdrew it. It needs a downstream with real on-disk fixture trees whose code under test does *not* spawn, and no such consumer has appeared. An `Effect`-returning form requiring `FileSystem` in `R` would satisfy the withdrawn ask; nothing has asked for a synchronous one.
- Whether a **published `layerTest`** should default to a fresh seeded volume instead of hard-providing `FileSystem.layerNoop`. Two carry the same question — `ActionEnvironment.layerTest` ([`@effected/github-actions`](github-actions.md), effected#248) and [`App.layerTest`](app.md#applayertest--the-hermetic-control-plane), whose documented limit is that any path exercising `ensure*` dies. Both are follow-ups owned by those packages, not this one, and both should be answered the same way: the shape of the answer is a kit convention, not a per-package taste.
