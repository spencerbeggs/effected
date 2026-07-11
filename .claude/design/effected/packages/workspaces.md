---
status: current
module: effected
category: architecture
created: 2026-07-10
updated: 2026-07-11
last-synced: 2026-07-11
completeness: 95
related:
  - ../effect-standards.md
  - ../migration-playbook.md
  - ../package-inventory.md
  - ../releases.md
  - ../package-setup.md
  - lockfiles.md
  - glob.md
  - walker.md
  - npm.md
  - package-json.md
---

# @effected/workspaces design

## Overview

**Merged** — migration #13, an **integrated-tier** package and the last of the workspaces-effect family to land. It is what remains of `workspaces-effect` (v2.0.3, ~8,200 lines) after two extractions that merged before it: [`@effected/lockfiles`](lockfiles.md) took the four lockfile parsers and integrity checking, and [`@effected/glob`](glob.md) took glob matching. What is left is the part that only makes sense with a filesystem and a package manager under it: **workspace root discovery, package enumeration, the dependency graph, package-manager detection, catalog resolution, lockfile IO and git-based change detection.**

This document is the design as specified, with an [As built](#as-built-2026-07-11) section recording what the port landed. The sections below are accurate unless that section says otherwise.

Design follows the [workspaces review](../../../reviews/workspaces.md), which found the *semantics* strong and v4-shaped and the *packaging* — kind-based folders, `*ErrorBase` workarounds, a static-wiring hack, triplicated dual APIs, two over-granular services, an over-engineered `Request`/`RequestResolver` cache — as the thing the redesign sheds.

Its gate consumer is `vitest-agent`, which uses `WorkspaceDiscovery`, `WorkspaceRoot`, their errors, and the two **synchronous** escape-hatch functions its Vitest config-time project discovery cannot avoid.

## Tier and dependencies

**Integrated tier**, and deliberately so. The `@pnpm/catalogs.*` quartet (`config`, `protocol-parser`, `resolver`, `types`, all `^1100.0.0`) is what makes it integrated, and it stays: those packages *are* pnpm's catalog semantics, versioned to pnpm majors, and reimplementing them would mean owning a moving spec with no oracle. A `@effected/pnpm-catalogs` split is a later one-module extraction if anything ever asks for it — not now.

Runtime dependencies:

| Dependency | Why |
| --- | --- |
| `@pnpm/catalogs.config` / `.protocol-parser` / `.resolver` / `.types` | pnpm catalog semantics — the tier-3 decision |
| `@effected/glob` (`workspace:*`) | dependency-pattern matching and the `packages:` enumerator |
| `@effected/lockfiles` (`workspace:*`) | the pure parsers this package feeds file content to |
| `@effected/walker` (`workspace:*`) | the upward ascent that finds the workspace root |
| `@effected/yaml` (`workspace:*`) | `pnpm-workspace.yaml` |
| `@effected/package-json` (`workspace:*`) | the full-manifest bridge and the corepack `packageManager` codec |
| `@effected/npm` (`workspace:*`) | the resolver **contracts** this package implements |
| `effect` (peer) | core |

**`minimatch` is gone.** It was a runtime dependency for exactly one method (`WorkspacePackage.matchesDependency`) plus a hand-rolled regex mini-glob in `glob-core.ts`; both retarget onto `@effected/glob`'s vendored engine. Neither call site keeps a private pattern semantic.

Node built-ins (`node:child_process`, `node:fs`, `node:path`) appear in exactly two places, both documented as Node-only overlays: the default `GitReader` layer and the `WorkspacesSync` escape hatch. They are built-ins, not dependencies, so they do not affect tier — but they are honest facts the v3 README denied ("no `node:` imports leak into your code") while `sync.ts` imported `node:fs` from the main entry.

## Implementing `@effected/npm`'s resolver contracts

[`@effected/npm`](npm.md) defines two shape-only service contracts that `@effected/package-json` needs but cannot implement — `CatalogResolver.rangeOf(name, catalog)` and `WorkspaceResolver.versionOf(name)` — and ships only no-op layers. **`@effected/workspaces` is the package that implements them.** That was the stated hypothesis when `npm` was spun out of the package-json port, and it holds: catalog resolution needs `pnpm-workspace.yaml` plus the lockfile, and workspace-version resolution needs the discovered package list. Both live here.

The implementations are exported as layers over this package's own services, not as new services:

- `WorkspaceCatalogs.catalogResolver` — `Layer<CatalogResolver, never, WorkspaceCatalogs>`; `rangeOf` consults the assembled `CatalogSet`.
- `WorkspaceDiscovery.workspaceResolver` — `Layer<WorkspaceResolver, never, WorkspaceDiscovery>`; `versionOf` consults the discovered packages.
- `Workspaces.resolvers` — the merged convenience layer.

Provide either alongside `Package.resolve` and a `package.json`'s `catalog:` / `workspace:` specifiers resolve for real instead of resolving to `Option.none()`. The contracts' documented convention is honoured exactly: an *unmatched* name is `Option.none()`, and the `DependencyResolutionError` channel is reserved for a failure of the resolution *mechanism* (an unreadable or malformed `pnpm-workspace.yaml`).

## The `packages:` enumerator and workspaces issue #62

v3's `glob-core.ts` compiled `packages:` patterns with a hand-rolled regex and carried a known degradation, recorded upstream as workspaces issue #62: **it silently rewrote a trailing `/**` to `/*`**, so `packages/**` matched only one level and a nested package went undiscovered with no diagnostic. That must not carry forward, and `@effected/glob` was built with the fix in mind — `GlobSet` exposes `literals` / `wildcards` / `excludes`, and `GlobPattern` exposes `enumerationPrefix` and `crossesSegments` *specifically* for this enumerator.

`internal/enumerate.ts` is the whole fix:

1. Compile the `packages:` list once with `GlobSet.compile` (default options; the drift-free contract — there is no options surface to diverge on).
2. **Literals** fast-path to an exact `root/<literal>/package.json` existence check.
3. **Wildcards** read from `enumerationPrefix`. When `crossesSegments` is false the enumerator does a single-level `readDirectory` — the v3 behaviour, correct for `packages/*`. When it is true (`packages/**`, `packages/*/*`, any globstar) it performs a **bounded iterative descent** from that prefix, testing each visited directory's root-relative POSIX path against the pattern.
4. **Excludes** (leading `!`) drop candidates after positive matching, as `GlobSet` defines.
5. A directory counts as a workspace package only if it holds a `package.json`.

The descent is a **worklist, not a recursion** — so it cannot overflow the stack, per the hardening skill's "remove the recursion" preference over "cap the recursion". It is bounded three ways: a `maxDepth` (default 32, guarded with `Number.isInteger` so `NaN` and fractions die rather than silently enumerating nothing), a visited-directory budget, and unconditional pruning of `node_modules` and `.git` (pnpm ignores `node_modules` in workspace globs; without the prune a `packages/**` in a repo with installed dependencies would walk the entire store).

A wildcard whose `enumerationPrefix` names a directory that does not exist fails typed (`WorkspacePatternError`), preserving v3's typo-catching behaviour with a structured error instead of a `reason` string.

## Module layout

Module-per-concept. Thirteen source modules (counting the re-export-only `index.ts`) plus `internal/`, replacing fifteen kind-based folders.

| File | Owns |
| --- | --- |
| `src/index.ts` | Re-exports only |
| `src/WorkspacePackage.ts` | `WorkspacePackage` class (getters, dependency queries, `dependencyDiff`, `matchesDependency` over `@effected/glob`, `manifest` bridging to `@effected/package-json`), `DependencyDiff` |
| `src/WorkspaceRoot.ts` | `WorkspaceRoot` service + layer (over `@effected/walker`), `WorkspaceRootNotFoundError` |
| `src/PackageManagerName.ts` | The `PackageManagerName` literal, `DetectedPackageManager`, `PackageManagerDetector` service + layer, `PackageManagerDetectionError` |
| `src/WorkspaceDiscovery.ts` | `WorkspaceInfo`, `WorkspaceDiscovery` service + layer, the `workspaceResolver` layer, `WorkspaceDiscoveryError`, `WorkspacePatternError`, `PackageNotFoundError` |
| `src/DependencyGraph.ts` | `DependencyGraph` **value class** (graph + topological sort + cycles), `CyclicDependencyError` |
| `src/ChangeDetector.ts` | `ChangeDetectionOptions`, `ChangeDetector` service + layer, `ChangeDetectionError` |
| `src/GitReader.ts` | `GitReader` service contract, `GitReader.layerNode`, `GitCommandError` |
| `src/WorkspaceCatalogs.ts` | `CatalogSet` class, `WorkspaceCatalogs` service + layer, the `catalogResolver` layer, `CatalogAssemblyError` |
| `src/LockfileReader.ts` | `LockfileReader` service + layer (the IO half of `@effected/lockfiles`), `LockfileReadError` |
| `src/Publishability.ts` | `PublishTarget`, `PublishabilityDetector` service + default layer |
| `src/Workspaces.ts` | The composite layers |
| `src/WorkspacesSync.ts` | The synchronous escape hatch (Node-only) |
| `src/internal/` | `traverse.ts` (**the** traversal state machine), `enumerate.ts` (the Effect enumerator over it), `patterns.ts` (`packages:` pattern reading), `catalogs.ts` (the `@pnpm/catalogs.*` boundary), `limits.ts` |

YAML-**stream** framing is *not* this package's job. `pnpm-lock.yaml` carries a config-dependencies preamble document ahead of the real lockfile whenever the workspace uses `configDependencies` (this repo's own lockfile is that shape), and a first-document parse silently returns the preamble: a few packages, no importers, no catalogs — an apparently empty workspace rather than a failure. [`@effected/lockfiles`](lockfiles.md#document-framing-a-lockfile-is-a-yaml-stream) owns it as of its #58, on a deterministic rule (pnpm's writer always emits the preamble as a *prefix*, so the lockfile is the **last** document), and surfaces a typed `LockfileFramingError` when a stream carries no lockfile document at all. `LockfileReader` therefore calls `Lockfile.parse` directly; an earlier richest-document-wins workaround here was deleted when #58 landed.

**One traversal, two entry points.** `internal/traverse.ts` owns the worklist, the dequeue discipline (a head index, never `Array.shift()` — `shift()` re-indexes the array on every dequeue, so draining a worklist near the 100,000-entry budget is quadratic), the depth rule, the visit budget and the prune list. Both `internal/enumerate.ts` (Effect) and `WorkspacesSync.ts` (sync) drive it; neither re-decides any of those. Two hand-written copies is not a style problem, it is how the two APIs came to **disagree**: the sync copy accepted a child *before* checking its depth, so it returned a package one level beyond the cap that the Effect enumerator rejected with `depthExceeded` on the identical tree. The depth cap bounds what is *enumerated*, not merely what is *descended into*. The single deliberate divergence that remains is what happens at a bound — the Effect path fails typed, the sync path truncates, because it has no error channel — and a test drives **both** entry points against one real tree at the boundary, since a test that exercises only one cannot catch this class of drift.

Two services from v3 are **deleted, not ported**:

- **`TopologicalSorter`** — sorting is a pure function of the graph. `sort` / `sortSubset` / `levels` are methods on the `DependencyGraph` value class.
- **`PackageResolver`** — file-to-owning-package is a lookup over discovery output. `resolveFile` / `resolveFiles` fold into `WorkspaceDiscovery`.

And the `Request` / `RequestResolver` / request-cache machinery in `DependencyGraphLive` and `LockfileReaderLive` is deleted outright: there is no batching win on a single-key resolver and nothing to deduplicate that the memoized init has not already done.

## Public surface

### `WorkspacePackage`

A `Schema.Class` carrying a located workspace member: `name`, `version`, `path`, `packageJsonPath`, `relativePath`, `private`, the four dependency maps, `publishConfig`.

It keeps its own **tolerant** manifest projection rather than embedding `@effected/package-json`'s `Package`. That is a deliberate call, not an oversight: `Package` requires `name: PackageName` and `version: SemVer.FromString`, so one workspace member with a non-semver version would fail *discovery* for the whole repo. Discovery must not be that brittle. The strict model is one method away — `pkg.manifest()` returns `Effect<Package, …>` by reading and decoding the file through `@effected/package-json` — so nothing is duplicated at the *semantic* level; `WorkspacePackage` is a different entity (a located member, discovered) from `Package` (a fully-typed manifest, decoded).

`matchesDependency(pattern: GlobPattern | string): boolean` replaces the `minimatch` call. Passing a `GlobPattern` is total and free; passing a `string` compiles it via `GlobPattern.make`, and an uncompilable literal is a **defect** — a glob in `matchesDependency("@types/*")` is developer wiring, not untrusted input, and the planning pillar puts wiring errors in the defect channel so the typed channel stays the domain errors a caller branches on. Compile once and reuse in a loop.

The v3 `declare static` + `index.ts` static-wiring hack disappears with the kind-based layout that caused it, and the triplicated dual statics go with it: instance methods are the API.

### `DependencyGraph`

A pure value class over `ReadonlyArray<WorkspacePackage>` with lazily-built private edge indexes — the `WorkspaceStateSnapshot` shape the review praised, applied to the graph. Total sync accessors (`names`, `adjacency`, `hasCycle`); fallible `Effect.fn` boundaries (`dependenciesOf`, `dependentsOf`, `sort`, `sortSubset`, `levels`).

Cycle detection is **iterative** (an explicit stack). v3's was a recursive DFS closure — a stack-overflow surface on a deep chain, and the one recursion in the package that survived the extraction of the parsers.

Kahn's algorithm is retained for level output (deterministic, lexicographically sorted within a level) but the v3 inner loop rescanned the whole adjacency map per processed node; the reverse-edge index this class already builds makes it linear.

> Core ships a `Graph` module (`effect/Graph`) with `Graph.topo` (Kahn) and `Graph.isAcyclic`. It was evaluated and **not** adopted: `Graph.topo` *throws* rather than failing typed, and the node-index indirection would have to be maintained alongside the name-keyed API this package's consumers already use. Revisit if `Graph` grows a typed cycle result.

### `WorkspaceRoot`, `WorkspaceDiscovery`, `PackageManagerDetector`

Three `Context.Service` classes, each with its layer in the same file.

`WorkspaceRoot.find(cwd)` is re-expressed over `@effected/walker`: `Walker.ascend` for the chain and `Walker.findRoot` for the marker test, inheriting walker's per-probe error absorption (one unreadable ancestor must not hide a valid root above it). Markers, in priority order: `pnpm-workspace.yaml`, then a `package.json` with a `workspaces` field.

`WorkspaceDiscovery` reads the `packages:` list (from `pnpm-workspace.yaml` via `@effected/yaml` — the v3 hand-rolled line-scanner is deleted — or the `workspaces` field of the root `package.json`), enumerates it through `internal/enumerate.ts`, and reads each `package.json`. It absorbs `PackageResolver`'s `resolveFile` / `resolveFiles` longest-prefix lookup.

`PackageManagerDetector` keeps the v3 priority chain — **lockfile evidence is the primary signal**, because it is what says which manager actually ran: `pnpm-workspace.yaml`, then `bun.lock`/`bun.lockb` plus a manifest field naming bun, then `yarn.lock` plus a manifest field naming yarn, then a `workspaces` field for npm. The manifest conjunction on bun and yarn is deliberate: a stray `yarn.lock` in an npm repo is common, and only a declared manager name disambiguates it.

#### The two fields that declare a manager

Corepack reads **both** the top-level `packageManager` and `devEngines.packageManager`, and they are not interchangeable. `packageManager` is **not** deprecated; `devEngines` (npm 10.9+, and broader — it also covers `runtime`, `cpu`, `os`, `libc`) is a validation and fallback layer *over* it, not a replacement. Corepack validates the two against each other when both are present, warning or throwing per `devEngines.packageManager.onFail` (`ignore` | `warn` | `error`, default error); when the top-level field is absent it falls back to `devEngines.packageManager`, which must then carry an explicit version.

The rule that falls out, and what the detector implements:

- **`devEngines.packageManager.name` is authoritative for the NAME.** Corepack *errors* when `packageManager` disagrees with it, so where both are present and disagree, `devEngines` is the one to believe. When `devEngines` names a manager, the top-level field's name is not consulted as a disambiguator at all.
- **The top-level `packageManager` is authoritative for the exact VERSION** — it is the field that carries the integrity hash. Where both name the same manager its version wins; where it is absent, `devEngines.packageManager.version` supplies the version.
- A version is reported **only when the field it came from names the manager actually detected**. A `packageManager: "yarn@4"` in a pnpm workspace says nothing about pnpm's version — the discipline v3 already had for `packageManager`, now extended to `devEngines`.

Both fields' versions are normalized through `@effected/package-json`'s `PackageManager.FromString` (the corepack `name@version+integrity` grammar) rather than a second parser, so a `devEngines` version carrying a hash — `11.11.0+sha512.…`, which **this repository's own root manifest does** — reports the same `11.11.0` the top-level field reports. A version that is not an exact version (a range like `^11`) yields none: a range is not a version, and corepack will not run one either.

**A malformed manifest hint is ignored, never fatal.** A non-object `devEngines`, a non-object or **array** `devEngines.packageManager` (corepack does not support arrays in that slot and falls back), a `name` containing `@`, or an unusable version cannot turn a detectable workspace into a detection failure. A manifest that is *present but unreadable or unparseable* is a different thing entirely and fails with a typed `WorkspaceManifestError` — a corrupt root manifest is a real problem, not a missing hint, and reporting "no manager declared" for it would be the same silent degradation the enumerator bug taught us to distrust. `detect`'s error channel is therefore `PackageManagerDetectionFailure = PackageManagerDetectionError | WorkspaceManifestError`.

`PackageManagerName` is this package's own literal (`"npm" | "pnpm" | "yarn" | "bun"`). It is structurally identical to `@effected/lockfiles`' `LockfileFormat` and assigns freely to it — which is what `LockfileReader` relies on — but they are different concepts (which package manager drives this workspace vs. which lockfile grammar to parse) that happen to share a carrier, and the name avoids colliding with `@effected/package-json`'s `PackageManager` (the corepack spec class) in a consumer's import list.

### Ambient `process.cwd()` becomes an explicit option

The review's sharpest DX finding: v3 hard-coded `process.cwd()` inside `LockfileReaderLive` and `CatalogResolverLive` init while `WorkspaceDiscovery` and `PointInTimeWorkspace` took a per-call `cwd` — inconsistently overridable, untestable in the hard-coded cases.

Here root resolution is **one concern, applied uniformly**: every root-consuming layer is `X.layer(options?: { readonly cwd?: string })`, defaulting to `process.cwd()` read lazily at first use (inside `Effect.suspend`, so a `process.chdir` between provide and first call is honoured). No service method reaches for the ambient cwd. Per the memoization discipline, a parameterized layer factory mints a fresh reference per call — bind it to a `const` once.

### `GitReader` — the subprocess seam

Effect v4 core has **no** `CommandExecutor` — the v3 `@effect/platform` dependency has no drop-in core successor, and `Stdio` is the *current process's* streams, not process spawning. What core does ship, in `effect/unstable/process`, is a `ChildProcessSpawner` **contract** (a `Context.Service` plus a `make` taking a spawn function) with **no Node implementation**; the Node one lives in `@effect/platform-node`. That is the same "core declares, platform implements" shape that decided the [runtime-resolver CLI split](runtime-resolver.md#the-effectcli-verdict-dead-on-v4-and-not-needed), reached independently from the other end, and it forces the same conclusion here: taking `@effect/platform-node` as a runtime dependency would push a platform adapter into every consumer's tree — exactly the escape the peer discipline exists to prevent.

(Verified against the pinned catalog beta and its matching `repos/effect-smol` subtree. An earlier draft of this section cited `4.0.0-beta.97`, the floating installed version from when the catalog carried a caret range; the catalogs now pin exactly, so the installed version and the subtree agree.)

So workspaces owns the seam: `GitReader` is a small `Context.Service` contract (`run(cwd, args)` returning `Effect<string, GitCommandError>`, plus `available(cwd)`), with `GitReader.layerNode` as the shipped default over `node:child_process.execFile` — locale-pinned `LC_ALL=C`, per-command timeout, both v3 hard-won details preserved. Consumers on Bun or Deno swap the layer; tests mock it with `Layer.succeed`. This is what makes `ChangeDetector` testable without a git repository, which v3 was not.

`GitNotAvailableError` and `GitReadError` — the review called their overlap out — collapse into one `GitCommandError` with a typed `kind` field.

### `WorkspaceCatalogs` and `CatalogSet`

`CatalogSet` is the immutable, fully-normalized catalog collection with the one resolution semantic (`empty` / `fromCatalogs` / `fromWorkspaceYaml` / `fromLockfileCatalogs` / `merge`, and `rangeOf`). `WorkspaceCatalogs` assembles it with pnpm's precedence — lockfile catalogs, then inline `pnpm-workspace.yaml` catalogs — and memoizes.

**`internal/catalogs.ts` is the only module that imports `@pnpm/catalogs.*`.** The tier-3 blast radius is one file: if the quartet ever has to be replaced or vendored, that is the file that changes.

### `WorkspacesSync` — the escape hatch, honestly labelled

`findWorkspaceRootSync(cwd?)` and `getWorkspacePackagesSync(root)`. Vitest's config-time project discovery cannot await, and `vitest-agent` — the gate consumer — calls exactly these two. Because this monorepo does not use subpath exports, the review's `./sync` subpath plan is not available; the module ships from the main entry and its TSDoc says plainly that it is Node-only and synchronous.

What it does **not** do is keep a third pattern semantic. v3's `sync.ts` hand-rolled its own YAML scrape and its own pattern expander (no `?` support, different negation handling) in defiance of glob-core's own anti-drift mandate. Here it compiles through the same `GlobSet` and enumerates through a synchronous mirror of the same worklist, so `packages/**` means the same thing in both worlds — the issue-#62 fix included.

## Error handling

Fifteen v3 error types with `reason: string` fields become nine `Schema.TaggedErrorClass` types with **structured** fields, per the house rule that a `reason` string flattens exactly the data a caller would branch on.

| Error | Raised by | Structure |
| --- | --- | --- |
| `WorkspaceRootNotFoundError` | `WorkspaceRoot` | `searchPath`, `markers` |
| `PackageManagerDetectionError` | `PackageManagerDetector` | `root`, `checked` |
| `WorkspaceManifestError` | `WorkspacePackage`, `PackageManagerDetector` | `packageJsonPath`, `kind`, `cause` |
| `WorkspaceDiscoveryError` | `WorkspaceDiscovery` | `root`, `path`, `kind`, `cause` |
| `WorkspacePatternError` | the enumerator | `root`, `pattern`, `kind` |
| `PackageNotFoundError` | discovery / graph | `name`, `available` |
| `CyclicDependencyError` | `DependencyGraph` | `cycle` |
| `GitCommandError` | `GitReader` | `kind`, `args`, `cwd`, `exitCode`, `stderr` |
| `ChangeDetectionError` | `ChangeDetector` | `operation`, `cause` |
| `CatalogAssemblyError` | `WorkspaceCatalogs` | `source`, `path`, `cause` |
| `LockfileReadError` | `LockfileReader` | `lockfilePath`, `format`, `cause` |

Every `kind` is a `Schema.Literals` discriminant, and every `cause` is a `Schema.Defect()`. `LockfileParseError` and `DependencyResolutionError` are **not** redefined — they arrive from `@effected/lockfiles` and `@effected/npm` respectively.

Per-method error unions stay narrow and exported as type aliases, which the review named best-in-class DX and which the v4 error ladder maps onto directly. The v3 `*ErrorBase` const workaround is deleted wholesale: the inline class-factory plus narrow `_base` suppression policy replaces it.

`SchemaError` never escapes: every `decodeUnknownEffect` boundary normalizes with `Effect.catchTag("SchemaError", …)` into the domain error above, preserving the parse detail on `cause` rather than v3's `"schema decode failed"` string.

## Lazy init, without `Effect.cached`'s interrupt trap

v3's strongest carryover is the lazy-init pattern: layer construction is O(1) and the heavy first-call IO (root find, PM detect, read, parse) is memoized, with init errors surfacing from each method's `E` channel. It is why a Vitest reporter that builds the layer per call site pays nothing.

The pattern survives, but **not** on bare `Effect.cached`. `Effect.cached` memoizes the first `Exit` — *including an interrupt*. An init interrupted by an unrelated `Effect.timeout` or a racing sibling would permanently brick the layer with a cause outside its declared error channel. The init memo is therefore success-only, via `Effect.cachedInvalidateWithTTL` at `Duration.infinity` with an `Effect.onExit` that invalidates on any non-success exit.

Success is computed once across sequential and concurrent observers; a failure or interrupt is retried on the next call. That is a behaviour *change* from v3 — where a transient failure was cached for the lifetime of the layer — and it is the right one.

## Observability

Named `Effect.fn` spans on public fallible boundaries only, uniformly. The v3 span names (`WorkspaceDiscovery.listPackages`, `DependencyGraph.dependenciesOf`, `CatalogResolver.resolve`, …) become the `Effect.fn` names one-for-one, upgrading them with stack frames at no cost. The `workspace.*` log-annotation namespace and Debug-level-only default silence are retained. No metrics; the app meters its calls.

## Hardening

Workspaces reads a filesystem, not a hostile string — but a filesystem is still an untrusted, potentially cyclic input, and the package still parses text.

- **The enumerator is a worklist, not a recursion** — it cannot overflow. Bounded by `maxDepth` (integer-guarded: `NaN` and `2.5` die, they do not silently enumerate nothing), a visited-directory budget, and the `node_modules` / `.git` prune. A symlink cycle terminates at the depth cap.
- **Cycle detection is iterative** — v3's recursive DFS is the one stack-overflow surface the extractions left behind.
- **YAML and JSON parsing** route through `@effected/yaml` and `Effect.try`-wrapped `JSON.parse`; both fail typed. A `JSON.parse` throw inside a `never`-channelled function is a defect no downstream `Effect.catch` absorbs — every one is wrapped at the point it can throw.
- **Malformed input fails typed, never as a defect** — the invariant, asserted with `Effect.flip` and `Effect.result` in the suite.
- **Developer wiring errors stay defects** — an uncompilable `matchesDependency` literal, a fractional `maxDepth`. The typed channel stays the domain errors a caller branches on.

## Testing

`@effect/vitest`, `it.effect`, `assert.*`, suite-boundary `layer(...)` — never per-test `Effect.provide`.

The whole package tests without `@effect/platform-node`: `Path.layer` and `FileSystem.layerNoop(partial)` both come from `effect` core, so a stubbed filesystem drives discovery, enumeration and PM detection with no platform dependency. One `layer(...)` block per distinct filesystem fixture (a suite-boundary layer cannot vary per test). `GitReader` mocks with `Layer.succeed`, so change-detection tests need no git repository — a capability v3 did not have.

The enumerator gets the mutation treatment the walker migration earned: fixtures where a match lands on the **first** and the **last** candidate, several directories with several candidates each, a `packages/**` case whose target is **two** levels down (the issue-#62 regression — it fails against the v3 `/**`-to-`/*` rewrite), a depth-cap case, a `node_modules`-prune case, and an exclusion that must actually exclude.

## Deferred (recorded, not forgotten)

Three v3 capabilities are **not** in v1, each with a reason and none of them on the gate:

- **`PointInTimeWorkspace` / `WorkspaceStateSnapshot`** — git at-ref workspace snapshots (`git cat-file -e` probe, `git show`, worktree catalog state). Substantial, and no gate consumer uses it. v1 lands the `GitReader` contract it needs, so it is a purely additive follow-up rather than a rework.
- **pnpmfile `configDependencies` hook replay** — v3 dynamically imports a config dependency's `pnpmfile.cjs` through `node:module` and replays its `updateConfig` hooks to inject catalogs. It executes arbitrary code from a config dependency and its correctness tracks pnpm internals. v1 assembles lockfile plus inline catalogs; in practice `pnpm pnpm:export` writes injected catalogs *inline* into `pnpm-workspace.yaml`, which v1 reads.
- **Decorative brands.** v3 defined, exported and documented `PackageName` and `WorkspacePath` branded schemas and applied them to nothing. They are dropped rather than shipped as API noise; `@effected/package-json` already owns a real `PackageName` brand for anyone who wants one.

## Build and scaffold

Standard per [package-setup.md](../package-setup.md). `savvy.build.ts` carries the narrow `_base` suppression (`{ messageId: "ae-forgotten-export", pattern: "_base" }`) for the synthesized class-factory bases; the gate is a zero-warning `dist/prod/issues.json` with only `*_base` symbols suppressed.

## As built (2026-07-11)

Merged with **133 tests**, a clean repo typecheck, biome and markdownlint, and a cold prod build whose zero-warning `issues.json` carries 27 suppressions, all synthesized class-factory `_base` symbols. The whole suite runs on a virtual filesystem built from core `FileSystem` and `Path`, with **one integration test that discovers this repository for real** — and that test is what earned its keep (below). Everything above landed as designed; `minimatch` is gone from both call sites, the `@pnpm/catalogs.*` quartet is confined to `internal/catalogs.ts`, and the two npm resolver contracts are implemented.

Four things the port established that the design could only assert:

1. **The `@effected/npm` hypothesis is confirmed.** When `npm` was spun out of the package-json port it was a bet that workspaces would be the package able to implement `CatalogResolver` and `WorkspaceResolver`. It is. Both ship as layers over this package's own services (`WorkspaceCatalogs.catalogResolver`, `WorkspaceDiscovery.workspaceResolver`, and the merged `Workspaces.resolvers`), and a manifest's `catalog:` / `workspace:` specifiers now resolve for real through `Package.resolve` instead of yielding `Option.none()`. The contracts' unmatched-name-is-`None` convention held without amendment.
2. **The self-discovery integration test found the lockfile bug.** Running discovery against this monorepo — rather than only against synthetic fixtures — is what surfaced that pnpm 11 writes `pnpm-lock.yaml` as two YAML documents under `configDependencies`, so a single-document parse silently returned the preamble and reported an empty workspace. The fix landed in `@effected/lockfiles` ([#58](lockfiles.md#document-framing-a-lockfile-is-a-yaml-stream)), where document framing belongs, on the deterministic last-document rule rather than the richest-document heuristic the first cut here reached for. A package that reads real-world files owes itself at least one test against a real-world file.
3. **The subprocess finding is the runtime-resolver finding.** Core declares a `ChildProcessSpawner` and implements it for no runtime, exactly as `Command.Environment` declares five services core implements for no runtime. Both packages independently concluded that a library must own a seam rather than take `@effect/platform-node`. That is now a rule, not a coincidence — see [GitReader](#gitreader--the-subprocess-seam).
4. **The two-entry-point traversal drift was real, not theoretical.** The sync copy accepted a child *before* checking its depth, so it returned a package one level beyond the cap that the Effect enumerator rejected. `internal/traverse.ts` owning the worklist, the dequeue discipline, the depth rule, the visit budget and the prune list is what closes it, and the test that drives **both** entry points against one real tree at the boundary is what proves it stays closed. A suite exercising only one entry point cannot catch this class of bug by construction.
