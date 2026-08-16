---
status: current
module: effected
category: architecture
created: 2026-08-14
updated: 2026-08-16
last-synced: 2026-08-16
completeness: 85
related:
  - ../effect-standards.md
  - ../package-inventory.md
  - ../package-setup.md
  - ../migration-playbook.md
  - glob.md
  - workspaces.md
  - github-actions-runtime.md
---

# @effected/memfs design

## Overview

`@effected/memfs` is an in-memory implementation of core Effect's `FileSystem` service: an isolated virtual POSIX volume — files, directories, symlinks, hard links, open descriptors, temp resources, globbing, watching — behind the standard `FileSystem.FileSystem` key, so any program or test that requires `FileSystem` in `R` runs against it unchanged. It exists because core ships only `FileSystem.layerNoop`, every kit package hand-stubs it in tests, and a hand stub that answered an unarranged read with `""` instead of failing caused a real silent-changeset-drop bug downstream (effected#249). The founding contract is **honest absence**: a read of a path nothing seeded fails typed (`SystemError` reason `NotFound`), never fabricates content.

The engine is a **vendored port with attribution** of an unmerged upstream contribution:

- **Engine**: Effect-TS/effect PR [#6573](https://github.com/Effect-TS/effect/pull/6573) "feat: add MemoryFileSystem module" by **lloydrichards**, built on **fubhy**'s design in effect-smol [#456](https://github.com/Effect-TS/effect-smol/pull/456). Pinned head: `c0528bd5cf12154aa95a7ceec243fd2045876853`. MIT, Effectful Technologies Inc.
- **Conformance suite**: Effect-TS/effect PR [#6555](https://github.com/Effect-TS/effect/pull/6555) "test: add file system test suite" (`FileSystemTest.ts`, ~60 contract tests parameterized over any `Layer<FileSystem, unknown>`), same author. Pinned head: `2492ba9df1c0fd25a2119aace82dafb2b7b8e77c`.

Vendored rather than waited-for because both PRs have sat unmerged for months and are not queued; the kit needs the capability now. **Sunset clause**: the release in which core's `effect` ships a `MemoryFileSystem` module, this package is deprecated in favor of it — the module name `MemoryFileSystem` deliberately mirrors upstream so the migration is an import-path change.

## Tier and dependencies

**Pure tier.** The package performs no host IO — the volume is immutable in-memory state (`HashMap`-backed inode table) behind a one-permit semaphore — and it *provides* `FileSystem` rather than requiring anything: the layer's `R` is `never`. `effect` is the only peer; zero runtime dependencies ([R1](../effect-standards.md#dependency-policy)).

**The zero-edges law: no `@effected/*` edge, ever — runtime, peer, or dev.** The package's whole purpose is to be the filesystem double every kit package's tests consume as a devDependency, `@effected/glob` included. Any edge from `memfs` back into the kit creates the cycle that law exists to prevent. Its one structural consequence: the engine **keeps the PR's embedded mini-glob** (brace expansion, character classes, globstar — ~340 lines) for the `FileSystem.glob` member, a deliberate duplication of capability `@effected/glob` also ships. Do not "deduplicate" by importing `@effected/glob`; the duplication is the price of the law, and the mini-glob serves only `fs.glob`, never a public matching API.

`@effect/platform-node` (`catalog:effect`) is a **devDependency only**, confined to the differential-oracle integration test — the `@effected/workspaces` `self.int.test.ts` precedent.

## Packaging decision

A new package, not a fold-in. Candidates surveyed honestly: `walker` (upward path traversal — wrong domain), `store` (durable SQLite state — wrong domain and tier 3), `commands`/`xdg` (wrong domains), `glob` (would invert the zero-edges law — memfs must be consumable *by* glob's tests). None fits; a test-support-shaped leaf that everything may devDepend on and that depends on nothing is the only shape without cycles.

Name: `memfs` (domain noun, instantly legible; the scope prevents npm collision with the unscoped `memfs` package). `volume` — the engine's own vocabulary — was considered and rejected as less discoverable. The public module is `MemoryFileSystem` for upstream parity (see sunset clause).

## Public surface

One module, service-less (it provides core's service; it declares none of its own):

- `MemoryFileSystem.make` — `Effect<FileSystem.FileSystem>`, a fresh empty volume.
- `MemoryFileSystem.makeWith(seed)` — a fresh volume pre-populated from a `path → MemoryFileSystemSeedEntry` record; parent directories are created recursively, then each entry applied in the record's own key order. The seeding record is the ergonomic replacement for the hand-stubbed `layerNoop` tree fixtures (`workspaces/__test__/fixtures.ts` is the template consumer).
- `MemoryFileSystem.layer` — `Layer<FileSystem.FileSystem>`, fresh volume per build.
- `MemoryFileSystem.layerWith(seed)` — the seeded layer. A **parameterized factory**: it mints a fresh reference per call — bind the result to a `const` rather than calling it at each composition site. A contradictory seed **dies** (wiring-bug posture); `makeWith` is the form that keeps seeding failures in the error channel.

### Seed entries (0.2.0)

A seed value is a `MemoryFileSystemSeedEntry`: the original `string | Uint8Array` contents, unchanged, or one of three tagged entries built by statics — `file(content, { mode? })`, `directory({ mode? })`, `symlink(target)`. One seed literal therefore describes a whole tree: files with initial modes (`0o644` default), *empty* directories (the only way a seed can express one) with modes (`0o755` default), and symbolic links whose target is stored verbatim and may dangle. A directory's mode is applied by a post-`makeDirectory` `chmod` so it lands even when that directory already exists — created implicitly as an earlier entry's parent.

### Fault injection (0.2.0)

A **delegate-by-default** wrapper over any `FileSystem`, built for the savvy-web-systems round-1 request:

- `MemoryFileSystem.makeFaulty(base, faults)` — the pure core: a wrapped `FileSystem` value, no Effect, no layer. The form to reach for when composing a filesystem value by hand.
- `MemoryFileSystem.layerFaulty(faults)` — `Layer<FileSystem, never, FileSystem>`: it *requires* the filesystem it wraps, so the composition is `layerFaulty({...}).pipe(Layer.provide(volume))` and the wrapped implementation need not be this package's.
- `MemoryFileSystem.layerFaultyWith(seed, faults)` — the self-contained convenience form (`layerFaulty(faults)` provided with `layerWith(seed)`).
- `MemoryFileSystem.failTimes(times, error)` — a transient fault: the first `times` intercepted calls fail with `error`, then delegation resumes forever.

The design decisions worth keeping:

- **`undefined` delegates.** A handler that returns nothing declines, and unregistered methods are never intercepted at all. This is the deliberate inverse of `FileSystem.layerNoop`'s deny-by-default, which is what forced downstream to buy one failing `chmod` by hand-building every other method the code path touched — paying `readDirectory: () => Effect.succeed([])`, an empty tree, so the recursion the test existed to prove never happened.
- **Handlers receive the real call arguments**, so a fault keys on the path or the mode of one specific call (the downstream case distinguishes the unlock pass, `0o755`, from the relock pass, `0o555`/`0o444`, inside a single call).
- **Faults are type-constrained to each method's own channel.** `MemoryFileSystemFaultHandler` returns the method's own return type, so an injected failure must be a genuine `PlatformError`; `Effect.fail(new Error(...))` does not compile. Downstream had a live test named for the `PlatformError` channel that failed with a bare `Error` and therefore never exercised it — exactly the silent fiction this package exists to kill.
- **All 30 function-valued members are interceptable** (`MemoryFileSystemFaultMethod` is derived, not enumerated by hand). The wrapper rebuilds the service through `FileSystem.make` over the 25 intercepted primitives, so a fault on a core method propagates coherently into the five members `make` derives (`access` → `exists`, `readFile` → `readFileString`, `writeFile` → `writeFileString`, `open` → `stream`/`sink`) — as an OS failure would. Those five are then **re-intercepted on top of the rebuilt service**, so each also remains directly interceptable. Without that second pass a fault registered on `readFileString` would be silently discarded by the re-derivation from an unfaulted `readFile` — a green test proving nothing, the trap the derived-member test group pins shut.
- **Effect-returning methods dispatch per execution** through `Effect.suspend`: a retried effect re-consults its handler, which is what lets `Effect.retry` attempts consume `failTimes` counts rather than one invocation consuming one. `watch`, `stream` and `sink` return `Stream`/`Sink` values and are handler-form only, consulted at invocation.
- **`failTimes` counters are armed per build**, not per fault value: each `makeFaulty` call and each layer build starts a fresh countdown, and `Layer.fresh` re-arms. `failTimes` **throws `RangeError`** on a negative or non-integer `times` — misuse is a wiring bug, the same posture as `layerWith`'s `orDie` on a contradictory seed.

Internal engine in `src/internal/volume.ts` (adapted `internal/memoryFileSystem.ts`); `src/MemoryFileSystem.ts` is the facade carrying both kit extensions; `src/index.ts` is the only re-exporting module.

## Behavioral contracts (what tests must pin)

- **Honest absence** — the #249 contract: reading, statting, or opening (without a create flag) any unseeded path fails typed with reason `NotFound`; nothing in the package can fabricate content for a path nothing arranged. The test naming this contract cites #249.
- **Error normalization**: every failure is core's `PlatformError` — `systemError` with a truthful `_tag`/`method`/`pathOrDescriptor`, or `badArgument` for malformed caller input. Malformed input **never defects**. The only `Effect.die` sites are genuine internal-invariant violations inherited from upstream (e.g. `createFile` returned a non-file inode).
- **Isolation**: each `make`/layer *build* is one volume. **Layer memoization is per-build, not per-value**: every `Effect.provide` of a layer value — even the same bound `const` — builds and re-seeds a fresh volume (and re-arms `failTimes` counters). Sharing one volume across several effects requires one provide of one composed layer graph; `Layer.fresh`'s only role is opting a consumer *inside* that graph back out into its own volume.
- **Modes are metadata, never enforced.** Modes set by seeding, `chmod`, `makeDirectory` or `writeFile` are recorded faithfully and readable via `stat`, but no operation checks them: the volume models no process identity (no uid/gid/umask), so nothing ever fails `PermissionDenied` on its own — a write to a `0o444` file succeeds. Confirmed as intended in the dogfood round (request item 5) rather than treated as a gap: modeling process identity is a large feature that **fault injection replaces more cheaply**, and injecting the failure is the sanctioned way to exercise a permission-failure path. `access` ignoring its `readable`/`writable`/`ok` options is the same contract, not a separate quirk — the previous docs stated only the `access` half and a reader reasonably read it as scoped there.
- **POSIX semantics** as the vendored engine defines them: bounded symlink traversal (40, exceeding → typed `BadResource`), root-clamped `..` (no escape), unlink-while-open keeps the inode until the last descriptor closes, no hard links to directories, relative paths resolve from `/` (the `FileSystem` contract has no cwd).

## Adaptation ledger (deliberate deltas from the pinned upstream)

Every delta is also recorded in the engine file's port-notes header; this is the authoritative list.

1. **`watch` honors `options?.recursive`.** Upstream's adapter ignores the `WatchOptions` parameter and infers recursion from the target being a directory; the beta.107 `FileSystem` interface passes the option, so the port honors it.
2. **Recursion surfaces are depth-guarded.** Upstream recurses unbounded in `containsDirectory`, `collectInodePaths`, `cloneInode`, `detachEntry`, `validateCopyDirectoryContents` and `findBraceExpansion`; a pathological tree would stack-overflow as a defect. Guarded at `MAX_NESTING_DEPTH = 256`, failing typed — guard-consistent with the format packages ([hardening standard](../effect-standards.md)).
3. **Seeding API** (`makeWith`/`layerWith`) is a kit extension; upstream has none. Widened in 0.2.0 from `path → contents` to the `MemoryFileSystemSeedEntry` union: the `file`/`directory`/`symlink` statics let one seed literal express empty directories, symbolic links (dangling allowed) and initial permission modes, so a tree of any size stops being a wall of imperative post-seed setup (downstream items 3 and 4).
4. **`access` ignores its `readable`/`writable`/`ok` options** — inherited upstream posture (there is no virtual process identity, so permission bits are metadata only); kept, and in 0.2.0 stated as the general mode-non-enforcement contract rather than an `access`-local footnote.
5. Mechanical: relative `../X.ts` imports → `"effect"` package imports with `.js` extensions, house formatting, TSDoc release tags, `assert.*` in tests.
6. **Upstream bug fixed** (worth reporting on PR #6573): `copy` with `overwrite: false` onto an existing destination reported the *source* path on its `AlreadyExists` error while every sibling conflict arm reports the destination; the port reports the destination, and the vendored contract suite's conditional assertion is adjusted to match (the node adapter never enters that branch — node's `fs.cp` with `force: false` silently preserves the destination).
7. **Fault-injection API** (`makeFaulty`/`layerFaulty`/`layerFaultyWith`/`failTimes`) is a kit extension; upstream has none. It lives in the facade, never in the ported engine — it wraps *any* `FileSystem`, so re-vendoring the engine cannot disturb it, and it is the piece that would need re-homing (not deleting) if the sunset clause fires.
8. **Docs correction, 0.2.0** (downstream item 6): the earlier "reusing one layer value shares one volume through memoization" claim was **wrong** and produced silent false greens downstream. Memoization is per *build*, so two provides of one bound `const` are two volumes and the second is re-seeded. The docs now carry the two-provide re-seed worked example, `Layer.provideMerge` guidance for composing one graph, `Layer.fresh`'s real role (per-consumer isolation *within* one build graph), and the `@effect/vitest` suite-boundary interaction: `layer(...)` memoizes one build for the whole suite, so a `failTimes` fault declared there is consumed by whichever test runs first and later tests silently see it exhausted.

Anything else that diverges from `c0528bd5` is drift, not design.

## Dogfood provenance (0.2.0)

The 0.2.0 wave is not speculative API design: every item was requested with a blocked call site by `savvy-web-systems` (round 1, 2026-08-16 — `.claude/dogfood/savvy-web-systems/`), and adopted downstream against the linked build with **zero handoff discrepancies**. Six files across two downstream packages migrated off hand-rolled filesystem stubs, and two of them gained real discriminating power rather than merely compiling: a stub answering `readFileString` with the same text for every path could not observe path correctness, and two permission tests had been injecting a denial into a filesystem where the file also did not exist, leaving "denied" and "missing" indistinguishable in fixtures whose entire purpose was separating them. The flagship case — a lockdown walk over a real recursive tree with only `chmod` intercepted — was verified by instrumented run, not by the green alone. Downstream deliberately kept two suites on real tmpdirs, where the point is the kernel *enforcing* a mode; that is the honest boundary of what fault injection substitutes for.

## Test strategy: the differential oracle

Four layers of proof, largest first:

1. **The vendored contract suite** (PR #6555's `FileSystemTest.ts`, adapted to house style) run against `MemoryFileSystem.layer`. The suite asserts `reason._tag`/`method`/`pathOrDescriptor` per operation, so it *is* the error-normalization oracle.
2. **The same suite against the real filesystem**: an integration test project running the identical suite over `@effect/platform-node`'s `FileSystem` layer (devDependency; `self.int.test.ts` pattern). Memory and disk passing one suite is the differential proof the port matches real semantics *on this beta* — the format-package differential-oracle pattern with the platform layer as the reference implementation.
3. **Memory-specific and kit tests**: the PR's 13 adapter tests (isolation, concurrent appends, watch events, hard-link fan-out, metadata) plus tests for the seeding API — tagged entries, dangling symlinks, modes landing in `stat`, a directory mode applied to a pre-existing parent — the honest-NotFound #249 contract, per-build isolation, and the watch-recursive adaptation.
4. **Fault-injection tests** (`__test__/FaultInjection.test.ts`, added 0.2.0; the project stands at 177 tests): the downstream chmod-relock scenario replayed over a real recursing tree; empty-map passthrough and unregistered-method delegation; path-keyed faults; **grouped direct-fault coverage of all five derived members** (`exists`, `readFileString`, `writeFileString`, `stream`, `sink`) proving none is silently bypassed by the re-derivation, alongside core-to-derived propagation; `watch` replacement *and* delegation; `failTimes` under `Effect.retry`, its per-build re-arm across two provides of one bound `const`, independent counters per `makeFaulty`, `failTimes(0)`, and `RangeError` on bad counts; and `@ts-expect-error` tests pinning the type enforcement (a bare `Error` fault, a transient fault on `watch`) — assertions that are only live because the package typechecks clean, so `types:check` is part of this test's proof.

The upstream pins are the anti-drift record: re-evaluating against a newer upstream head is a deliberate re-vendor with this doc updated, never an in-place edit.

## Attribution

The glob house pattern: `src/internal/volume.ts` opens with a `Ported from … / Copyright … / License: MIT / Port notes:` header naming both PRs, both pinned SHAs, both authors (lloydrichards; fubhy for the effect-smol#456 design), and the adaptation ledger in brief. The adapted test suite carries the same header for PR #6555. README credits both PRs. **Never edit the notice text.** Effect is MIT (Effectful Technologies Inc.), compatible with the kit's MIT license.

## Open questions

- Whether `ActionEnvironment.layerTest` (`@effected/github-actions`, effected#248) should default to a fresh seeded volume instead of hard-providing `FileSystem.layerNoop` — confirmed as a post-port follow-up owned by that package, not this one.

Resolved at port time: the contract suite roots every path it touches under `makeTempDirectoryScoped({ prefix: "effect-filesystem-test-" })` with no `directory` option, so the node oracle runs confined to the host's `os.tmpdir()` and never touches the repository tree — verified by the green `integration/node.int.test.ts` run.
