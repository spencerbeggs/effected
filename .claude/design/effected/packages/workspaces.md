---
status: current
module: effected
category: architecture
created: 2026-07-10
updated: 2026-07-20
last-synced: 2026-07-20
completeness: 95
related:
  - ../effect-standards.md
  - ../package-inventory.md
  - ../releases.md
  - ../package-setup.md
  - lockfiles.md
  - glob.md
  - walker.md
  - npm.md
  - package-json.md
  - git.md
---

# @effected/workspaces design

## Overview

`@effected/workspaces` is the **integrated-tier** monorepo tooling package: the part of workspace management that only makes sense with a filesystem and a package manager under it — **workspace root discovery, package enumeration, the dependency graph, package-manager detection, catalog resolution, lockfile IO, git-based change detection and point-in-time workspace snapshots.** The four lockfile parsers and integrity checking live in [@effected/lockfiles](lockfiles.md); glob matching lives in [@effected/glob](glob.md); typed git introspection lives in [@effected/git](git.md). This package composes all three over the workspace model.

Its gate consumer is `vitest-agent`, which uses `WorkspaceDiscovery`, `WorkspaceRoot`, their errors, and the two **synchronous** escape-hatch functions its Vitest config-time project discovery cannot avoid.

## Tier and dependencies

**Integrated tier**, and deliberately so. The `@pnpm/catalogs.*` quartet is what makes it integrated: those packages *are* pnpm's catalog semantics, versioned to pnpm majors, and reimplementing them would mean owning a moving spec with no oracle. A `@effected/pnpm-catalogs` split is a later one-module extraction if anything asks for it.

Runtime dependencies:

| Dependency | Why |
| --- | --- |
| `@pnpm/catalogs.config` / `.protocol-parser` / `.resolver` / `.types` | pnpm catalog semantics — the tier-3 decision |
| `@effected/glob` (`workspace:~`) | dependency-pattern matching and the `packages:` enumerator |
| `@effected/lockfiles` (`workspace:~`) | the pure parsers this package feeds file content to |
| `@effected/walker` (`workspace:~`) | the upward ascent that finds the workspace root |
| `@effected/yaml` (`workspace:~`) | `pnpm-workspace.yaml` |
| `@effected/package-json` (`workspace:~`) | the full-manifest bridge and the corepack `packageManager` codec |
| `@effected/npm` (`workspace:~`) | the resolver **contracts** this package implements |
| `@effected/git` (`workspace:~`) | typed git introspection — `ChangeDetector` and `WorkspaceSnapshots` run on its `Git` service |
| `effect` (peer) | core |

There is no `minimatch` dependency — dependency-pattern matching and the enumerator's mini-glob both run on `@effected/glob`'s vendored engine. Subprocess spawning lives entirely behind `@effected/git`'s `ChildProcessSpawner` contract; there is no `node:child_process` anywhere here. Two modules are Node-only, and both are opt-in rather than on the main path. `ConfigDependencyHooks.layerLive` does an in-process dynamic `import()` of a config dependency's pnpmfile — a built-in/dynamic-import, not a dependency, so it does not affect tier, and its TSDoc names it plainly. `src/node-sync.ts` imports `node:fs` / `node:path`, but it is a **separate entry point** (`@effected/workspaces/node-sync`) that the index never re-exports, so nothing reaches it unless a consumer imports the subpath by name — the main entry stays platform-free (see [the escape hatch](#workspacessync--the-escape-hatch)). `WorkspacesSync` itself imports `node:*` not at all: since the 2026-07-16 retrofit its file and path operations are consumer-supplied.

## Implementing @effected/npm's resolver contracts

[@effected/npm](npm.md) defines two shape-only service contracts that `@effected/package-json` needs but cannot implement — `CatalogResolver.rangeOf(name, catalog)` and `WorkspaceResolver.versionOf(name)` — and ships only no-op layers. **`@effected/workspaces` implements them**: catalog resolution needs `pnpm-workspace.yaml` plus the lockfile, and workspace-version resolution needs the discovered package list, both of which live here.

The implementations are exported as layers over this package's own services:

- `WorkspaceCatalogs.catalogResolver` — `Layer<CatalogResolver, never, WorkspaceCatalogs>`; `rangeOf` consults the assembled `CatalogSet`.
- `WorkspaceDiscovery.workspaceResolver` — `Layer<WorkspaceResolver, never, WorkspaceDiscovery>`; `versionOf` consults the discovered packages.
- `Workspaces.resolvers` — the merged convenience layer.

Provide either alongside `Package.resolve` and a `package.json`'s `catalog:` / `workspace:` specifiers resolve for real instead of `Option.none()`. The contracts' convention holds exactly: an *unmatched* name is `Option.none()`, and the error channel is reserved for a failure of the resolution *mechanism*.

**The assembly error is npm's, and it passes through typed** (2026-07-16, dogfood item 3). `CatalogAssemblyError` **moved to `@effected/npm`** — the contract package owns the contract's error vocabulary — and `CatalogResolver.rangeOf`'s channel is now `CatalogAssemblyError | DependencyResolutionError`. `WorkspaceCatalogs.catalogResolver` therefore no longer folds an assembly failure into `DependencyResolutionError`'s defect `cause` (which forced consumers to `_tag`-sniff `unknown`): an unreadable or malformed catalog source passes through as the typed `CatalogAssemblyError`, and only the remaining mechanism failure — an unfindable workspace root — is wrapped as `DependencyResolutionError`. This package imports the error back from npm and deliberately does **not** re-export it. `WorkspaceStateSnapshot`'s snapshot-scoped resolver satisfies the widened channel vacuously — its catalogs were assembled at capture, so its `rangeOf` is total.

Two conveniences sit on top (2026-07-16, dogfood items 2 and 4):

- **`Workspaces.resolverLayer(options?)`** — `Layer<CatalogResolver | WorkspaceResolver, never, FileSystem | Path>`: `resolvers` pre-wired over `layerWithConfigDependencies(options)`, so the two contracts need only a platform from the consumer. It is **deliberately a parameterized layer function, and the fresh layer per call is the feature**: layers memoize by reference, so each call mints an unmemoized layer whose root discovery re-runs — including a per-call `process.cwd()` read when `options.cwd` is omitted. A build tool that changes directory between manifests gets a correct re-discovery each time precisely because nothing is shared across calls; a consumer that wants sharing binds one call's result to a `const`. Catalog assembly takes the hook-replay path — compose `resolvers` with `layer()` yourself if config-dependency code must not run in process.
- **`Workspaces.resolveManifest(manifest, options?)`** — the one-shot 90% path: `manifest.resolve()` (npm's `Manifest`, [npm.md](npm.md#manifest-tolerant-manifest-level-resolution)) provided with a fresh `resolverLayer(options)` per call. Consumers processing many manifests check the pure `manifest.needsResolution` first and skip the call — and catalog assembly — entirely when nothing needs resolving.

## The packages: enumerator

`internal/enumerate.ts` compiles the `packages:` list once with `GlobSet.compile` and enumerates the workspace, fixing a class of degradation where a trailing `/**` silently collapses to `/*` so a nested package goes undiscovered with no diagnostic. `GlobSet` exposes `literals` / `wildcards` / `excludes` and `GlobPattern` exposes `enumerationPrefix` / `crossesSegments` specifically for this enumerator:

1. Compile the `packages:` list once (default options; there is no options surface to diverge on).
2. **Literals** fast-path to an exact `root/<literal>/package.json` existence check.
3. **Wildcards** read from `enumerationPrefix`. When `crossesSegments` is false, a single-level `readDirectory`; when it is true (`packages/**`, `packages/*/*`, any globstar), a **bounded iterative descent** from that prefix, testing each visited directory's root-relative POSIX path against the pattern.
4. **Excludes** (leading `!`) drop candidates after positive matching.
5. A directory counts as a workspace package only if it holds a `package.json`.

The descent is a **worklist, not a recursion**, so it cannot overflow the stack. It is bounded three ways: a `maxDepth` (default 32, integer-guarded so `NaN` and fractions die rather than silently enumerating nothing), a visited-directory budget, and unconditional pruning of `node_modules` and `.git`. A wildcard whose `enumerationPrefix` names a nonexistent directory fails typed (`WorkspacePatternError`).

> **Core-overlap ticket (unresolved):** core ships `FileSystem.glob(pattern, { root, exclude })`, overlapping this enumerator's traversal half (the matcher half stays `@effected/glob`, which core does not duplicate). Whether `FileSystem.glob` honours the semantics this enumerator guarantees — the `packages/**` bounded descent, the `node_modules`/`.git` prune, the integer-guarded depth cap, the typed failure at a bound, and the one-state-machine discipline shared with `WorkspacesSync` — needs a behavioral probe before any replacement. Until that probe passes, the enumerator stays. Core's `FileSystem.watch(path): Stream<WatchEvent>` is where any future watch-mode discovery would build.

## Module layout

Module-per-concept.

| File | Owns |
| --- | --- |
| `src/index.ts` | Re-exports only |
| `src/WorkspacePackage.ts` | `WorkspacePackage` class (getters, dependency queries, `dependencyDiff`, `matchesDependency` over `@effected/glob`, `manifest` bridging to `@effected/package-json`), `DependencyDiff` |
| `src/WorkspaceRoot.ts` | `WorkspaceRoot` service + layer (over `@effected/walker`), `WorkspaceRootNotFoundError` |
| `src/PackageManagerName.ts` | The `PackageManagerName` literal, `DetectedPackageManager`, `PackageManagerDetector` service + layer, `PackageManagerDetectionError` |
| `src/WorkspaceDiscovery.ts` | `WorkspaceInfo`, `WorkspaceDiscovery` service + layer, the `makeTest` / `layerTest` test double, the `workspaceResolver` layer, `WorkspaceDiscoveryError`, `WorkspacePatternError`, `PackageNotFoundError` |
| `src/DependencyGraph.ts` | `DependencyGraph` **value class** (graph + topological sort + cycles), `CyclicDependencyError` |
| `src/ChangeDetector.ts` | `ChangeDetectionOptions`, `ChangeDetector` service + layer (over `@effected/git`'s `Git`), `ChangeDetectionError` |
| `src/WorkspaceCatalogs.ts` | `CatalogSet` class, `WorkspaceCatalogs` service + layer, the `catalogResolver` layer |
| `src/WorkspaceSnapshots.ts` | `WorkspaceSnapshots` service + layers, the snapshot error unions |
| `src/WorkspaceStateSnapshot.ts` | `WorkspaceStateSnapshot` and `PackageStateSnapshot` value classes |
| `src/ConfigDependencyHooks.ts` | `ConfigDependencyHooks` contract service, `layerLive`, `layerNoop` |
| `src/LockfileReader.ts` | `LockfileReader` service + layer (the IO half of `@effected/lockfiles`), `LockfileReadError` |
| `src/Publishability.ts` | `PublishTarget`, `PublishabilityDetectorShape`, `PublishabilityDetector` service + default layer |
| `src/Workspaces.ts` | The composite layers, `resolverLayer`, `resolveManifest` |
| `src/WorkspacesSync.ts` | The synchronous escape hatch over consumer-supplied ops (`SyncFileSystem`, `SyncPath`, `WorkspacesSyncOptions`) |
| `src/node-sync.ts` | **A second package entry** (`@effected/workspaces/node-sync`) — `nodeSyncOps` over `node:fs` / `node:path`; the only module here that imports `node:*` |
| `src/internal/` | `traverse.ts` (the traversal state machine), `enumerate.ts` (the Effect enumerator over it), `patterns.ts` (`packages:` pattern reading), `catalogs.ts` (the `@pnpm/catalogs.*` boundary), `limits.ts` |

`CatalogAssemblyError` used to be this package's own leaf module; it now lives in `@effected/npm` beside the `CatalogResolver` contract that names it (see [the error seam](#implementing-effectednpms-resolver-contracts)). `WorkspaceCatalogs`, `ConfigDependencyHooks` and `WorkspaceSnapshots` import it from npm; its `source` literal keeps the `"hooks"` arm.

YAML-**stream** framing is not this package's job. `pnpm-lock.yaml` carries a config-dependencies preamble document ahead of the real lockfile whenever the workspace uses `configDependencies` (this repo's own lockfile is that shape); a first-document parse silently returns the preamble — an apparently empty workspace rather than a failure. [@effected/lockfiles](lockfiles.md#document-framing-a-lockfile-is-a-yaml-stream) owns it on a deterministic rule (pnpm's writer always emits the preamble as a prefix, so the lockfile is the **last** document) and surfaces a typed `LockfileFramingError` when a stream carries no lockfile document. `LockfileReader` therefore calls `Lockfile.parse` directly.

**One traversal, two entry points.** `internal/traverse.ts` owns the worklist, the dequeue discipline (a head index, never `Array.shift()` — `shift()` re-indexes the array on every dequeue, so draining a near-budget worklist is quadratic), the depth rule, the visit budget and the prune list. Both `internal/enumerate.ts` (Effect) and `WorkspacesSync.ts` (sync) drive it; neither re-decides any of those. The depth cap bounds what is *enumerated*, not merely what is *descended into*. The one deliberate divergence between the two entry points is what happens at a bound — the Effect path fails typed, the sync path truncates because it has no error channel — and a test drives **both** entry points against one real tree at the boundary.

Sorting and file-to-package lookup are not services: `sort` / `sortSubset` / `levels` are methods on the `DependencyGraph` value class, and `resolveFile` / `resolveFiles` fold into `WorkspaceDiscovery`. There is no `Request` / `RequestResolver` cache — there is no batching win on a single-key resolver and nothing the memoized init has not already deduplicated.

## Public surface

### WorkspacePackage

A `Schema.Class` carrying a located workspace member: `name`, `version`, `path`, `packageJsonPath`, `relativePath`, `private`, the four dependency maps, `publishConfig`, and `manifestRecord`. It keeps a **tolerant** manifest projection rather than embedding `@effected/package-json`'s `Package`: `Package` requires `name: PackageName` and `version: SemVer.FromString`, so one member with a non-semver version would fail *discovery* for the whole repo. The strict model is one method away — `pkg.manifest()` returns `Effect<Package, …>` by reading and decoding the file through `@effected/package-json` — so `WorkspacePackage` (a located member, discovered) and `Package` (a fully-typed manifest, decoded) are different entities, not duplicates.

**`manifestRecord`** (2026-07-16, dogfood item 5) is the as-read `package.json` record, **captured at discovery**, so a consumer needing a field outside the typed slice (`scripts`, `exports`, …) reads it without a second file read or a strict decode that can fail on odd manifests. Values are `unknown` and unvalidated beyond being a record; it defaults to `{}` for construction sites and previously-serialized values that predate the field. Two decisions around it are deliberate: the re-reading `manifest()` **stays** — its point-in-time refresh semantics depend on re-reading, which a captured record cannot provide — and `PackageStateSnapshot` is **not** widened to carry it; the snapshot remains the narrow store-and-diff value, and bloating every stored snapshot with full manifests would tax the store for a field diffing never reads.

`matchesDependency(pattern: GlobPattern | string): boolean` replaces the `minimatch` call. Passing a `GlobPattern` is total and free; passing a `string` compiles via `GlobPattern.make`, and an uncompilable literal is a **defect** — a glob in `matchesDependency("@types/*")` is developer wiring, not untrusted input. Compile once and reuse in a loop.

### DependencyGraph

A pure value class over `ReadonlyArray<WorkspacePackage>` with lazily-built private edge indexes. Total sync accessors (`names`, `adjacency`, `hasCycle`); fallible `Effect.fn` boundaries (`dependenciesOf`, `dependentsOf`, `sort`, `sortSubset`, `levels`). Cycle detection is **iterative** (an explicit stack), not a recursive DFS — no stack-overflow surface on a deep chain. Kahn's algorithm gives deterministic, lexicographically-sorted level output, made linear by the reverse-edge index the class already builds.

> Core's `effect/Graph` (`Graph.topo`, `Graph.isAcyclic`) is **not** adopted: `Graph.topo` *throws* rather than failing typed, and the node-index indirection would have to be maintained alongside the name-keyed API consumers already use. Revisit if `Graph` grows a typed cycle result.

### WorkspaceRoot, WorkspaceDiscovery, PackageManagerDetector

Three `Context.Service` classes, each with its layer in the same file.

`WorkspaceRoot.find(cwd)` runs over `@effected/walker` — `Walker.ascend` for the chain and `Walker.findRoot` for the marker test — inheriting per-probe error absorption. Markers, in priority order: `pnpm-workspace.yaml`, then a `package.json` with a `workspaces` field.

`WorkspaceDiscovery` reads the `packages:` list (from `pnpm-workspace.yaml` via `@effected/yaml`, or the `workspaces` field of the root `package.json`), enumerates it through `internal/enumerate.ts`, reads each `package.json`, and absorbs the longest-prefix file-to-package lookup.

**The test double** (2026-07-17, [issue #109](https://github.com/spencerbeggs/effected/issues/109)): `WorkspaceDiscovery.makeTest(overrides?)` returns a `WorkspaceDiscoveryShape` with every method defaulted, and `WorkspaceDiscovery.layerTest(overrides?)` is `Layer.succeed` over it — the house `layerTest` naming ([store](store.md) and [app](app.md)). The defaults model an empty workspace, and the derived methods (`importerMap`, `getPackage`, `resolveFile` / `resolveFiles`) run over the *effective* `listPackages` — the override when one is supplied — so stubbing only `listPackages` yields a consistent double: longest-prefix ownership for the file resolvers (POSIX-terminated; a win32 fixture supplies its own override) and the service's own typed `PackageNotFoundError` on a `getPackage` miss, exactly as the live implementation fails. `info()` **dies as a defect** by default: no honest default `WorkspaceInfo` exists (a fabricated root path would leak into consumer path logic), so an unstubbed call is a test-wiring mistake that fails loudly rather than succeeding with a lie.

`PackageManagerDetector` uses a priority chain where **lockfile evidence is the primary signal** — it is what says which manager actually ran: `pnpm-workspace.yaml`, then `bun.lock`/`bun.lockb` plus a manifest field naming bun, then `yarn.lock` plus a manifest field naming yarn, then a `workspaces` field for npm. The manifest conjunction on bun and yarn disambiguates a stray `yarn.lock` in an npm repo.

#### The two fields that declare a manager

Corepack reads **both** the top-level `packageManager` and `devEngines.packageManager`, and they are not interchangeable. `packageManager` is not deprecated; `devEngines` is a validation and fallback layer over it. Corepack validates the two against each other when both are present and falls back to `devEngines.packageManager` when the top-level field is absent. The detector implements:

- **`devEngines.packageManager.name` is authoritative for the NAME.** Corepack *errors* when `packageManager` disagrees with it, so where both are present and disagree, `devEngines` wins. When `devEngines` names a manager, the top-level field's name is not consulted as a disambiguator.
- **The top-level `packageManager` is authoritative for the exact VERSION** — it carries the integrity hash. Where both name the same manager its version wins; where it is absent, `devEngines.packageManager.version` supplies the version.
- A version is reported **only when the field it came from names the manager actually detected.** A `packageManager: "yarn@4"` in a pnpm workspace says nothing about pnpm's version.

Both fields' versions normalize through `@effected/package-json`'s `PackageManager.FromString` (the corepack `name@version+integrity` grammar), so a `devEngines` version carrying a hash reports the same version the top-level field would. A range like `^11` yields none — a range is not a version, and corepack will not run one.

**A malformed manifest hint is ignored, never fatal.** A non-object `devEngines`, a non-object or array `devEngines.packageManager`, a `name` containing `@`, or an unusable version cannot turn a detectable workspace into a detection failure. A manifest that is *present but unreadable or unparseable* is different — it fails with a typed `WorkspaceManifestError`, because a corrupt root manifest is a real problem, not a missing hint. `detect`'s error channel is `PackageManagerDetectionError | WorkspaceManifestError`.

`PackageManagerName` is this package's own literal (`"npm" | "pnpm" | "yarn" | "bun"`). It is structurally identical to `@effected/lockfiles`' `LockfileFormat` and assigns freely to it (which `LockfileReader` relies on), but they are different concepts sharing a carrier, and the name avoids colliding with `@effected/package-json`'s `PackageManager` (the corepack spec class) in a consumer's import list.

### PublishabilityDetector

A `Context.Service` deciding whether a package publishes and to where. Its shape is the **exported `PublishabilityDetectorShape` interface**, for symmetry with `WorkspaceDiscoveryShape` — a swappable service whose whole point is that consumers override it must let a consumer *name the type they are implementing* without reaching into the class.

The default layer implements **npm's** semantics, not necessarily anyone's: `private` with no `publishConfig.access` publishes nowhere; an explicit `publishConfig.access` overrides `private`; anything else publishes to the public registry.

**The contract is degrade-or-die**, now stated on the service rather than implied by the signature. `detect`'s error channel is deliberately **`never`**, because every caller — the release planner iterating a whole workspace, most of all — treats "does this publish?" as a **total** question. An overriding layer whose lookup *can* fail therefore has exactly two honest moves: fold the recoverable failure into a safe answer (usually the empty target list), or `Effect.orDie` it into the defect channel. It may not widen the channel the contract declares. Writing this down is the point: the `never` was always load-bearing, but a consumer reading only the signature could mistake it for an accident of the default implementation rather than a rule their layer inherits.

`PublishConfig` gains an optional `linkDirectory` boolean, completing the pnpm-flavored fields the projection carries.

### Ambient cwd is an explicit option

Root resolution is one concern, applied uniformly: every root-consuming layer is `X.layer(options?: { readonly cwd?: string })`, defaulting to `process.cwd()` read lazily at first use (inside `Effect.suspend`, so a `process.chdir` between provide and first call is honoured). No service method reaches for the ambient cwd. A parameterized layer factory mints a fresh reference per call — bind it to a `const` once.

### WorkspaceCatalogs and CatalogSet

`CatalogSet` is the immutable, fully-normalized catalog collection with the one resolution semantic (constructors plus `merge` and `rangeOf`). It carries statics for its three sources: `fromLockfile`, `fromBunBlocks` and `fromManifestWorkspaces`. `WorkspaceCatalogs` assembles it with pnpm's precedence and memoizes. **`internal/catalogs.ts` is the only module that imports `@pnpm/catalogs.*`** — the tier-3 blast radius is one file.

The reader is **PM-aware**. File presence picks the reader: `pnpm-workspace.yaml` present → the pnpm path; absent → the root `package.json` `workspaces.catalog` / `catalogs` path (bun's analogue). The catalog readers **hard-fail by design** because their output is load-bearing for diffing — a silently-empty read is the "every dependency looks added" bug:

- A present-but-malformed `workspaces` shape (a number, a string, an object with malformed `packages`/`catalog`/`catalogs`) fails with `CatalogAssemblyError`. An absent field, or one explicitly `null`, yields empty.
- The default catalog declared **twice** — once as `workspaces.catalog` and again as `workspaces.catalogs.default` — is rejected, checked structurally so an explicitly-declared empty catalog (`catalog: {}`) still counts as a declaration.

The policy contrast is deliberate: `PackageManagerDetector` **degrades gracefully** on malformed hints (a heuristic with a fallback chain), while the catalog readers **hard-fail** (load-bearing output). Lockfile catalogs are PM-aware too — assembly draws from whichever extension the parsed lockfile carries (pnpm and bun both carry catalogs).

### WorkspacesSync — the escape hatch

`findWorkspaceRootSync(cwd, options)` and `getWorkspacePackagesSync(root, options)`. Both are positional-path-first with the ops bag second, and `findWorkspaceRootSync`'s `cwd` is **required** — the sync module reads no ambient `process.cwd()` ([issue #110](https://github.com/spencerbeggs/effected/issues/110) removed an options-bag form with an optional `cwd` that had drifted in during the 2026-07-16 retrofit; `FindWorkspaceRootSyncOptions` is gone with it and the bag type is plain `WorkspacesSyncOptions`). Vitest's config-time project discovery cannot await, and `vitest-agent` — the gate consumer — calls exactly these two. The sync surface ships from the main entry, its TSDoc saying plainly that it is synchronous. It keeps **no third pattern semantic**: it compiles through the same `GlobSet` and enumerates through a synchronous mirror of the same worklist, so `packages/**` means the same thing in both worlds.

**Retrofitted to consumer-supplied ops** (2026-07-16, dogfood items 7 and 9; breaking, accepted under `0.x`). The design rule, stated by Spencer for every sync escape hatch in the kit: **the kit never imports `node:*` and never assumes posix — a sync surface takes the platform from its caller.** `WorkspacesSyncOptions` carries a `SyncFileSystem` (`exists` / `readFile` / `readDirectory` / `isDirectory`) and a `SyncPath` (`join` / `dirname` / `resolve`), both minimal structural interfaces that Node's built-ins satisfy verbatim — `node:fs` functions one-liner each, and `node:path` (or `node:path/win32`, or a Bun/Deno equivalent) *is* a `SyncPath`. Windows correctness is therefore the consumer passing a win32-appropriate `path`, not anything in this module — the same convention as `@effected/tsconfig-json`'s `TsconfigLoaderSync` ([tsconfig-json.md](tsconfig-json.md#tsconfigloadersync--the-sync-facade)). Throwing consumer ops degrade to the documented skip semantics; nothing propagates.

**`@effected/workspaces/node-sync` — the second entry point.** Hand-wiring four `node:fs` one-liners at every adoption site is a tax the rule above imposed on the common case, and a tax paid per consumer is a tax paid wrong. This subpath supplies ready-made `nodeSyncOps` (`SyncFileSystem` + `SyncPath` over `node:fs` / `node:path`), making the Node case one import while leaving the rule intact.

It is **deliberately not re-exported from the index**, and this is the whole point of it being a separate entry: re-exporting it would drag `node:*` imports into the main entry and therefore into every consumer — including the ones that supply their own ops precisely to avoid them (a win32-explicit `path`, a Bun or Deno binding, a test fake). **The main entry stays platform-free**; the platform binding is opt-in by import path. `nodePath` is the *running* platform's `node:path`, so on Windows this hands back win32 paths — which is the correct default only for a consumer who means "Node, here."

It is the repo's first subpath export, and the entry-point status has one consequence worth recording: **an entry point re-exports, contrary to the [no-barrel rule](../effect-standards.md#module-layout-module-per-concept)** — api-extractor models each entry as its own surface, so the three op types appearing in this entry's declarations must be re-exported here or the build reports `ae-forgotten-export` for all three. The rule bans barrels, not entry points; this is an entry point.

## Git integration

`ChangeDetector` and `WorkspaceSnapshots` run on [@effected/git](git.md)'s `Git` service — the typed git surface (`show`, `lsTree`, `refExists`, `mergeBase`, `changedFiles`, `workingChanges`, `revParse`, `checkout`) over core's `Command` values with `ChildProcessSpawner` in `R`. Requiring a core-declared service in `R` costs a consumer nothing (R3), which is why this package owns no subprocess seam of its own. A test provides `Layer.succeed(Git, …)` and needs no git repository on disk.

- **`ChangeDetector`** computes a committed range via `Git.changedFiles(relative: true)` and `includeUncommitted` via `Git.workingChanges(relative: true)`. A non-repository surfaces as git's typed `NotARepositoryError`, alongside the package's own `ChangeDetectionError`.
- **`WorkspaceSnapshots`** answers "what did this workspace look like at that moment" — `at(ref)` and `worktree()`, both returning a `WorkspaceStateSnapshot`.

### WorkspaceSnapshots

`WorkspaceStateSnapshot` is a value class — `packages: ReadonlyArray<PackageStateSnapshot>` (name, version, relative path, the four dependency records) plus `catalogs: CatalogSet` — with lazily-built, instance-cached private indexes **outside** the schema (the `DependencyGraph` precedent) backing `versions`, `package(name)` and `resolve(dependency, specifier)`. `resolve` answers "what did this specifier mean HERE": `workspace:` against this snapshot's package versions, `catalog:` against this snapshot's catalog set. Specifier classification goes through [@effected/npm](npm.md)'s `DependencySpecifier`, and the dependency-section vocabulary comes from npm's consolidated schema. The snapshot is serializable by construction. Beyond `resolve`, a snapshot hands back layers implementing npm's `CatalogResolver` and `WorkspaceResolver` contracts against *itself*, so anything written to the contracts can run "as of" a ref.

**`at(ref)`** reads workspace state at a git ref with no checkout, via `Git.show` and `Git.lsTree`:

- Workspace globs come from `pnpm-workspace.yaml` at the ref, **or** from the root `package.json` `workspaces` field when the YAML is absent. Without this fallback a bun or npm workspace collapses to the root package alone at a ref, and a consumer diffing two snapshots sees every declared dependency as newly added, with no error — a named regression test.
- Package directories come from the compiled `@effected/glob` set matched against `lsTree` entries — the at-ref discovery [glob.md](glob.md) records.
- Each package's `package.json` is read with `show`; a path absent at the ref is skipped (`Option.none` from `Git.show`, never an error).
- Catalogs assemble from the inline source at the ref plus **the detected package manager's own lockfile at the ref**. `Lockfile.parse` is format-aware and both `PnpmExtension` and `BunExtension` carry catalogs. The root manifest's inline bun catalogs are read **unconditionally**, not gated on `bun.lock` presence — gating them reintroduces the "every dep looks added" bug for a bun repo with inline catalogs but a not-yet-committed lockfile. Parity-tested against `worktree()`.

**`worktree()`** reads the live tree over `WorkspaceDiscovery` and `WorkspaceCatalogs`, uncached — the **one** shared read path between worktree snapshots and catalog assembly; there is no second manifest/lockfile read for the worktree.

Mechanics follow the house rules: caching per `(root, ref)` via `Effect.cachedInvalidateWithTTL(Duration.infinity)` with invalidate-on-non-success; a `{ cwd }` option resolving the root by walking up; two named error unions kept narrow — **`WorkspaceSnapshotAtFailure`** (git errors ∪ `CatalogAssemblyError` ∪ `WorkspaceRootNotFoundError`; `at` never enumerates the live filesystem) and **`WorkspaceSnapshotWorktreeFailure`** (discovery errors ∪ `CatalogAssemblyError` ∪ `WorkspaceRootNotFoundError`; `worktree` never invokes git).

**Documented property — at/worktree hook-catalog asymmetry.** `WorkspaceSnapshots.at` never replays config-dependency hooks: it reads inline catalogs plus the lockfile at the ref only. So under `layerWithConfigDependencies`, an `at("HEAD")` snapshot and a `worktree()` snapshot can disagree on hook-injected catalogs. This is deliberate — an at-ref read must not execute historical `pnpmfile.cjs` code — but a consumer relying on at/worktree catalog parity should know the two paths diverge exactly on the hook-injected set.

### ConfigDependencyHooks — the opt-in replay seam

`ConfigDependencyHooks` is a contract service with two layers. `layerLive` does an in-process dynamic `import()` of each config dependency's `pnpmfile.cjs` and replays its `updateConfig` hooks over the inline-catalog seed — in-process code loading, no subprocess. `layerNoop` is the no-execution stand-in.

- **Opt-in by layer choice.** The default `WorkspaceCatalogs.layer` and `Workspaces.layer` wire `layerNoop` — they **never** execute config-dependency code. `layerWithConfigDependencies` opts into `layerLive`.
- **Assembly precedence** is lockfile < inline < hook-injected, merged per-dependency within a catalog, with the hooks seeded by the inline catalogs — matching pnpm's own behavior.
- **Failure is typed, never silent.** A config dependency that fails to load or replay fails with a `"hooks"`-source `CatalogAssemblyError`.
- **Security guard:** `layerLive` rejects a config-dependency name containing a `..` path segment **before** building the `import()` target, so a malicious `configDependencies` entry cannot escape the intended directory.

## Error handling

The package's own `Schema.TaggedErrorClass` types with **structured** fields:

| Error | Raised by | Structure |
| --- | --- | --- |
| `WorkspaceRootNotFoundError` | `WorkspaceRoot` | `searchPath`, `markers` |
| `PackageManagerDetectionError` | `PackageManagerDetector` | `root`, `checked` |
| `WorkspaceManifestError` | `WorkspacePackage`, `PackageManagerDetector` | `packageJsonPath`, `kind`, `cause` |
| `WorkspaceDiscoveryError` | `WorkspaceDiscovery` | `root`, `path`, `kind`, `cause` |
| `WorkspacePatternError` | the enumerator | `root`, `pattern`, `kind` |
| `PackageNotFoundError` | discovery / graph | `name`, `available` |
| `CyclicDependencyError` | `DependencyGraph` | `cycle` |
| `ChangeDetectionError` | `ChangeDetector` | `operation`, `cause` |
| `LockfileReadError` | `LockfileReader` | `lockfilePath`, `format`, `cause` |

Every `kind` is a `Schema.Literals` discriminant and every `cause` is a `Schema.Defect()`. Git's typed errors (`GitCommandError`, `NotARepositoryError`, `UnknownRefError`) arrive from `@effected/git` and surface alongside `ChangeDetectionError` in `ChangeDetector`'s channel. `LockfileParseError` arrives from `@effected/lockfiles`; `DependencyResolutionError` and `CatalogAssemblyError` arrive from `@effected/npm` — `CatalogAssemblyError` is raised here (by `WorkspaceCatalogs`, `ConfigDependencyHooks` and `WorkspaceSnapshots`) but owned there, and not re-exported. Per-method error unions stay narrow and are exported as type aliases. `SchemaError` never escapes: every `decodeUnknownEffect` boundary normalizes with `Effect.catchTag("SchemaError", …)` into the domain error, preserving the parse detail on `cause`.

## Lazy init

Layer construction is O(1) and the heavy first-call IO (root find, PM detect, read, parse) is memoized, with init errors surfacing from each method's `E` channel — so a Vitest reporter that builds the layer per call site pays nothing.

The memo is **not** bare `Effect.cached`. `Effect.cached` memoizes the first `Exit`, *including an interrupt* — an init interrupted by an unrelated `Effect.timeout` or a racing sibling would permanently brick the layer with a cause outside its declared error channel. The init memo is therefore success-only, via `Effect.cachedInvalidateWithTTL` at `Duration.infinity` with an `Effect.onExit` that invalidates on any non-success exit. Success is computed once across sequential and concurrent observers; a failure or interrupt is retried on the next call.

## Observability

Named `Effect.fn` spans on public fallible boundaries only, uniformly (`WorkspaceDiscovery.listPackages`, `DependencyGraph.dependenciesOf`, `CatalogResolver.resolve`, …), upgraded with stack frames at no cost. The `workspace.*` log-annotation namespace and Debug-level-only default silence are retained. No metrics.

## Hardening

Workspaces reads a filesystem, not a hostile string — but a filesystem is still an untrusted, potentially cyclic input, and the package parses text.

- **The enumerator is a worklist, not a recursion** — bounded by `maxDepth` (integer-guarded), a visited-directory budget and the `node_modules` / `.git` prune. A symlink cycle terminates at the depth cap.
- **Cycle detection is iterative** — an explicit stack, no stack-overflow surface.
- **YAML and JSON parsing** route through `@effected/yaml` and `Effect.try`-wrapped `JSON.parse`; both fail typed. Every `JSON.parse` is wrapped at the point it can throw.
- **Malformed input fails typed, never a defect** — asserted with `Effect.flip` and `Effect.result`.
- **Developer wiring errors stay defects** — an uncompilable `matchesDependency` literal, a fractional `maxDepth`.

## Testing

`@effect/vitest`, `it.effect`, `assert.*`, suite-boundary `layer(...)` — never per-test `Effect.provide`.

The whole package tests without `@effect/platform-node`: `Path.layer` and `FileSystem.layerNoop(partial)` come from `effect` core, so a stubbed filesystem drives discovery, enumeration and PM detection. Change-detection and snapshot tests mock `@effected/git`'s `Git` service with `Layer.succeed`, so they need no git repository. One integration test discovers *this repository* for real — the test that surfaces real-world file shapes (it is what surfaced the pnpm 11 config-dependencies lockfile-framing shape, now owned in `@effected/lockfiles`).

Mutation-proven edges:

- The enumerator: fixtures where a match lands on the **first** and the **last** candidate, several directories with several candidates, a `packages/**` case whose target is **two** levels down (the `/**`-to-`/*` regression), a depth-cap case, a `node_modules`-prune case, and an exclusion that must actually exclude.
- The two-entry-point traversal drift: a test drives **both** `enumerate.ts` and `WorkspacesSync.ts` against one real tree at the depth boundary — the sync copy once accepted a child before checking its depth, returning a package one level beyond the cap the Effect enumerator rejected.
- A bun or npm workspace read at a ref must not collapse to the root package alone; `at("HEAD")` and `worktree()` agree on a clean tree (which also pins the unconditional inline-bun-catalog read).
- The double-default rejection (`workspaces.catalog` plus `workspaces.catalogs.default`), checked structurally.
- Hook replay through the opt-in layer against a fixture pnpmfile; the default layer provably never loads it.
- TTL-cache discipline: a failed `at(ref)` init is retried, not memoized.

## Build

Standard per [package-setup.md](../package-setup.md). `savvy.build.ts` carries the narrow `_base` suppression (`{ messageId: "ae-forgotten-export", pattern: "_base" }`) for the synthesized class-factory bases; the gate is a zero-warning `dist/prod/issues.json` with only `*_base` symbols suppressed. The prod gate's expected suppressed count is **28** (`suppressed: 0` in the prod gate means the build did not run properly).
