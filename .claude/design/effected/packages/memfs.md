---
status: current
module: effected
category: architecture
created: 2026-08-14
updated: 2026-08-14
last-synced: 2026-08-14
completeness: 80
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
- `MemoryFileSystem.makeWith(seed)` — a fresh volume pre-populated from a `path → string | Uint8Array` record; parent directories are created recursively, then each file written. The seeding record is the ergonomic replacement for the hand-stubbed `layerNoop` tree fixtures (`workspaces/__test__/fixtures.ts` is the template consumer).
- `MemoryFileSystem.layer` — `Layer<FileSystem.FileSystem>`, fresh volume per build.
- `MemoryFileSystem.layerWith(seed)` — the seeded layer. A **parameterized factory**: it mints a fresh reference per call, and layers memoize by reference — bind the result to a `const` (house memoization discipline). Per-test isolation from one bound layer is `Layer.fresh`.

Internal engine in `src/internal/volume.ts` (adapted `internal/memoryFileSystem.ts`); `src/index.ts` is the only re-exporting module.

## Behavioral contracts (what tests must pin)

- **Honest absence** — the #249 contract: reading, statting, or opening (without a create flag) any unseeded path fails typed with reason `NotFound`; nothing in the package can fabricate content for a path nothing arranged. The test naming this contract cites #249.
- **Error normalization**: every failure is core's `PlatformError` — `systemError` with a truthful `_tag`/`method`/`pathOrDescriptor`, or `badArgument` for malformed caller input. Malformed input **never defects**. The only `Effect.die` sites are genuine internal-invariant violations inherited from upstream (e.g. `createFile` returned a non-file inode).
- **Isolation**: each `make`/layer build is one volume; separately built layers share nothing. Reusing one layer value shares one volume through memoization — documented, not a bug.
- **POSIX semantics** as the vendored engine defines them: bounded symlink traversal (40, exceeding → typed `BadResource`), root-clamped `..` (no escape), unlink-while-open keeps the inode until the last descriptor closes, no hard links to directories, relative paths resolve from `/` (the `FileSystem` contract has no cwd).

## Adaptation ledger (deliberate deltas from the pinned upstream)

Every delta is also recorded in the engine file's port-notes header; this is the authoritative list.

1. **`watch` honors `options?.recursive`.** Upstream's adapter ignores the `WatchOptions` parameter and infers recursion from the target being a directory; the beta.107 `FileSystem` interface passes the option, so the port honors it.
2. **Recursion surfaces are depth-guarded.** Upstream recurses unbounded in `containsDirectory`, `collectInodePaths`, `cloneInode`, `detachEntry`, `validateCopyDirectoryContents` and `findBraceExpansion`; a pathological tree would stack-overflow as a defect. Guarded at `MAX_NESTING_DEPTH = 256`, failing typed — guard-consistent with the format packages ([hardening standard](../effect-standards.md)).
3. **Seeding API** (`makeWith`/`layerWith`) is a kit extension; upstream has none.
4. **`access` ignores its `readable`/`writable`/`ok` options** — inherited upstream posture (there is no virtual process identity, so permission bits are metadata only); kept, but stated in TSDoc rather than left implicit.
5. Mechanical: relative `../X.ts` imports → `"effect"` package imports with `.js` extensions, house formatting, TSDoc release tags, `assert.*` in tests.

Anything else that diverges from `c0528bd5` is drift, not design.

## Test strategy: the differential oracle

Three layers of proof, largest first:

1. **The vendored contract suite** (PR #6555's `FileSystemTest.ts`, adapted to house style) run against `MemoryFileSystem.layer`. The suite asserts `reason._tag`/`method`/`pathOrDescriptor` per operation, so it *is* the error-normalization oracle.
2. **The same suite against the real filesystem**: an integration test project running the identical suite over `@effect/platform-node`'s `FileSystem` layer (devDependency; `self.int.test.ts` pattern). Memory and disk passing one suite is the differential proof the port matches real semantics *on this beta* — the format-package differential-oracle pattern with the platform layer as the reference implementation.
3. **Memory-specific and kit tests**: the PR's 13 adapter tests (isolation, concurrent appends, watch events, hard-link fan-out, metadata) plus new tests for the seeding API, the honest-NotFound #249 contract, `Layer.fresh` isolation, and the watch-recursive adaptation.

The upstream pins are the anti-drift record: re-evaluating against a newer upstream head is a deliberate re-vendor with this doc updated, never an in-place edit.

## Attribution

The glob house pattern: `src/internal/volume.ts` opens with a `Ported from … / Copyright … / License: MIT / Port notes:` header naming both PRs, both pinned SHAs, both authors (lloydrichards; fubhy for the effect-smol#456 design), and the adaptation ledger in brief. The adapted test suite carries the same header for PR #6555. README credits both PRs. **Never edit the notice text.** Effect is MIT (Effectful Technologies Inc.), compatible with the kit's MIT license.

## Open questions

- Whether `ActionEnvironment.layerTest` (`@effected/github-actions`, effected#248) should default to a fresh seeded volume instead of hard-providing `FileSystem.layerNoop` — confirmed as a post-port follow-up owned by that package, not this one.

Resolved at port time: the contract suite roots every path it touches under `makeTempDirectoryScoped({ prefix: "effect-filesystem-test-" })` with no `directory` option, so the node oracle runs confined to the host's `os.tmpdir()` and never touches the repository tree — verified by the green `integration/node.int.test.ts` run.
