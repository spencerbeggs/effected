---
status: current
module: effected
category: architecture
created: 2026-07-10
updated: 2026-07-25
last-synced: 2026-07-25
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
| `@effected/commands` (`workspace:~`) | the `LocalExec` **contract** this package implements — a boundary-tier edge, so [R2](../effect-standards.md#dependency-policy) does not propagate anything |
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

## Implementing @effected/commands' LocalExec contract

The second inverted contract this package fills, on the same reasoning as [npm's resolvers](#implementing-effectednpms-resolver-contracts). [@effected/commands](commands.md) needs package-manager detection and workspace-root resolution for its tool discovery, and both live here — but a direct `commands` → `workspaces` edge would make that **boundary-tier** package integrated, and through the planned `npm` → `commands` edge would drag `npm`, `lockfiles` (pure!) and `package-json` up a tier with it. So `commands` declares the narrow `LocalExec` contract and **`@effected/workspaces` ships `Workspaces.localExecLayer(options?)`**, a `Layer<LocalExec, never, PackageManagerDetector | WorkspaceRoot>`.

**The R2 direction is what makes this safe.** The `@effected/commands` edge is a `workspace:~` dependency on a *boundary* package, and [R2](../effect-standards.md#dependency-policy) taxes only tier-3 edges — so taking it changes nothing about this package's tier (already integrated, for `@pnpm/catalogs.*`) and costs a consumer nothing extra. The inversion exists to protect `commands` and its dependents, not us.

**The argv knowledge is not duplicated.** `LocalExec.prefixes(name)` in `commands` is the one home of the four managers' `exec`/`dlx` prefixes; this layer detects *which* manager owns the directory and asks `commands` what that manager's argv looks like. The tests assert against that same static rather than a copy, so the two packages cannot silently drift apart on the table.

**`None` is success, and the boundary is where the value is.** The contract reserves its typed `LocalExecError` for **mechanism** failure, so the mapping from this package's error taxonomy is:

| Condition | Answer | Why |
| --- | --- | --- |
| No workspace root above `cwd` | `Option.none()` | "No project-local way to run tools here" is an ordinary fact; a bare directory should not have to catch an error to learn it. |
| `PackageManagerDetectionError` | `Option.none()` | The detector found no evidence and [refused to guess](#the-standalone-and-declaration-tiers). No identifiable launcher is the same honest absence. |
| `WorkspaceManifestError` | `LocalExecError` | A manifest that exists but cannot be read or parsed is **broken**, not absent. Reporting `None` here would tell a caller "no local tooling" when the truth is "your repository is damaged". |

That split falls straight out of the detector's own two-error taxonomy, which is why it is stated rather than invented. All three rows are mutation-pinned in both directions — turning either `None` row into an error, and degrading the error row into `None`, each fails its own test.

`directory` on the resulting `ExecContext` is the resolved **workspace root**, not the caller's cwd: a project-local launcher has to run where the workspace is, and resolving that root is the reason this layer exists rather than `LocalExec.layerFor`. The `{ cwd }` option follows the house [ambient-cwd convention](#ambient-cwd-is-an-explicit-option), read per call rather than at layer construction.

A consumer with no monorepo never needs this layer and therefore never installs this package: `LocalExec.layerNone` and `LocalExec.layerFor(manager)` are one-liners in `commands`. That asymmetry is the entire payoff of the inversion.

## Publishability as a contract seam (draft)

Drafted 2026-07-25 at Spencer's request, ahead of the systems dogfood. **Design only — nothing below is built.** The claim under review: `PublishabilityDetector` is described in its own source comment as the package's headline swappable service ("standard npm semantics are the default, and an organization with its own publish rules replaces the layer"), and the downstream evidence says that swap does not currently work the way the comment promises.

### Current state: what silk-effects actually has to do

`@savvy-web/silk-effects` is the real consumer, and it performs **three** distinct contortions to impose its own policy.

**1. The default implementation is unreachable except through the tag it occupies.** `SilkPublishability.ts:454` reads:

```ts
const vanilla = yield* Effect.provide(PublishabilityDetector, PublishabilityDetector.layer);
```

Silk's adaptive detector has a `mode: "vanilla"` branch that wants *our* npm semantics. Because those semantics exist only as a `Layer` bound to `PublishabilityDetector` — the very tag silk is replacing — it must build that layer and provide it to the tag **inside** its own implementation of that tag, purely to get a function it could otherwise have called. This is the highest-value thing to fix and the cheapest: the rules should be reachable as a value.

**2. The composite bakes the default in, so the graph is threaded twice.** `Workspaces.ts:102` ends:

```ts
return Layer.mergeAll(roots, detector, discovery, lockfiles, catalogs, PublishabilityDetector.layer);
```

so `Workspaces.layer()` / `layerWithGit()` always provide npm semantics. Silk's composition (`changesets/services/deps-regen.ts:645-651`) therefore passes `kitGraph` **twice** — once as the base, and once *into* its own override, which needs discovery to work — and relies on `Layer.provide` shadowing to beat the default the base is still supplying:

```ts
const kitGraph = Workspaces.layerWithGit(options);
return DepsRegenLive.pipe(
  Layer.provide(ConfigInspectorLive.pipe(Layer.provide(Layer.mergeAll(ChangesetConfigReaderLive, kitGraph)))),
  Layer.provide(PublishabilityDetectorAdaptiveLive.pipe(Layer.provide(Layer.mergeAll(ConfigGraph, kitGraph)))),
  Layer.provide(ConfigGraph),
  Layer.provide(kitGraph),          // still carrying the default detector
);
```

**3. The override is silently order-dependent, in the dangerous direction.** Probed against `effect@4.0.0-beta.101`:

| Composition | Resolves to |
| --- | --- |
| `mergeAll(composite, custom)` | **CUSTOM** ✅ |
| `mergeAll(custom, composite)` | **DEFAULT** ❌ |
| `custom.pipe(Layer.provideMerge(composite))` | **CUSTOM** ✅ |

Last-wins. So `Layer.mergeAll(myDetector, Workspaces.layer())` — which reads in English as "my detector, plus the workspace services" — **silently reverts to npm semantics**. There is no type error and no warning. For a service that decides *whether a package publishes and to which registry*, a silent revert to "publishes to the public npm registry with `access: public`" is the worst available failure mode, and it is one word-order away at every call site.

That third point is what turns this from an ergonomics complaint into a correctness one.

### (a) The shape stays; the empty array is the open question, not the answer type

`detect(pkg) => Effect<ReadonlyArray<PublishTarget>>` is right and should not become a richer classification **yet**. Every consumer surveyed asks exactly one question of it — `targets.length > 0`:

- our `VersioningStrategy.detect` (`VersioningStrategy.ts:165-172`),
- silk's `listPublishablePackageNames` (`changesets/utils/publishability.ts:44-48`).

Nothing reads a reason, so a reason channel would be speculative API against this package's ships-on-evidence discipline. **But the conflation is real and worth recording**: silk's adaptive detector returns `[]` for three different facts — the package is changeset-ignored, the repo's mode is `none`, or the package genuinely does not publish. A user asking "why didn't my package release?" cannot be answered from the contract's output.

**Trigger to revisit:** the first consumer that must *explain* an exclusion rather than act on it. The additive shape then is a second method (`explain(pkg) => Effect<Exclusion>`), not a change to `detect` — `detect`'s totality is what makes it cheap to call in a loop over every package.

The `never` error channel also stays. Silk's config lookups are fallible and it folds them ("degrade or die", already documented on the shape); that cost is deliberate and buys every consumer a total question.

### (b) Remove the default from the composites; require it in R

**Recommendation: `Workspaces.layer()` and `layerWithGit()` stop providing `PublishabilityDetector` and start requiring it**, exactly as [`ToolDiscovery.layer` requires `LocalExec`](commands.md) and as [npm's resolver contracts](npm.md#resolver-contracts) are required rather than defaulted.

```ts
// before — the default is invisible and beats a naively-ordered override
Layer.Layer<WorkspacesServices, never, FileSystem | Path>

// after — the choice is in the type, and unmade wiring does not compile
Layer.Layer<WorkspacesServices, never, FileSystem | Path | PublishabilityDetector>
```

Why this over the alternatives:

- **Over an options bag** (`Workspaces.layer({ publishability })`): a layer passed as an option still hides the decision inside a call, and its own `R` would have to be threaded through the composite's signature. The R-hole states the requirement in the one place a reader already looks.
- **Over keeping the default and documenting the ordering**: documentation does not fix a silent revert. The failure mode is a correct-looking composition that publishes to the wrong registry.
- **Over `Layer.mock` / shadowing helpers**: those address tests, not production policy.

The cost is one explicit line for the common case, which is the point — it makes "npm semantics" a **choice** rather than an ambient default nobody knew they had:

```ts
const WorkspacesLayer = Workspaces.layer().pipe(Layer.provide(PublishabilityDetector.layerNpm));
```

### (c) The npm rules stay here, as one implementation among peers — and as a value

They are genuine npm semantics and belong in the package that models npm workspaces; nothing is gained by exiling them. Two changes make them a peer rather than a default:

- **Rename `PublishabilityDetector.layer` → `layerNpm`.** A static called `layer` reads as "the" layer; once no composite provides it automatically, the name should say which policy it is. Add `layerNone` (publishes nothing) for the CI-dry-run and test cases silk currently expresses with `mode: "none"`.
- **Expose the rules as a value: `PublishabilityDetector.npm: PublishabilityDetectorShape`**, with `layerNpm = Layer.succeed(PublishabilityDetector, PublishabilityDetector.npm)`. This is the direct fix for contortion #1 — silk's vanilla branch becomes `yield* PublishabilityDetector.npm.detect(pkg)`, deleting the `Effect.provide`-inside-the-override entirely.

That last point generalizes beyond this seam: **any shipped implementation of a swappable contract should be reachable as a value, not only as a layer bound to the tag it occupies.** A consumer composing *around* the default cannot use a layer without re-entering the tag it is replacing.

### Worked before/after, on silk's real composition

```ts
// BEFORE — kitGraph threaded twice; the base still supplies a default that the
// override must out-shadow; the "vanilla" branch re-instantiates our layer.
const kitGraph = Workspaces.layerWithGit(options);
return DepsRegenLive.pipe(
  Layer.provide(ConfigInspectorLive.pipe(Layer.provide(Layer.mergeAll(ChangesetConfigReaderLive, kitGraph)))),
  Layer.provide(PublishabilityDetectorAdaptiveLive.pipe(Layer.provide(Layer.mergeAll(ConfigGraph, kitGraph)))),
  Layer.provide(ConfigGraph),
  Layer.provide(kitGraph),
);

// AFTER — one graph, one provide, no shadowing. The detector is a dependency of
// the composite rather than a competitor to it.
const detector = PublishabilityDetectorAdaptiveLive.pipe(Layer.provide(ConfigGraph));
const kitGraph = Workspaces.layerWithGit(options).pipe(Layer.provide(detector));
return DepsRegenLive.pipe(Layer.provide(ConfigGraph), Layer.provide(kitGraph));
```

The detector still needs workspace services in its own right (it reads `pkg.packageJsonPath`), but it takes them from `FileSystem` + `ChangesetConfig`, not from the composite — so the cycle that forced the double-threading disappears.

### (d) Migration cost

| Site | Cost |
| --- | --- |
| `VersioningStrategy.detect` | **None.** Already requires `PublishabilityDetector` in `R`; it never resolved a default. |
| `Workspaces.layer` / `layerWithGit` | Signature change: `RIn` gains `PublishabilityDetector`. Internal only — `compose` drops one merge member. |
| In-kit tests composing the composite | One `Layer.provide(PublishabilityDetector.layerNpm)` each. |
| Releases tooling / `@effected/app` | Same one line, at the edge where the platform layer already goes. |
| silk-effects | **Net deletion**: the double-threaded `kitGraph`, the shadowing reliance, and the `Effect.provide`-inside-the-override all go. |

Pre-1.0, and the only breaking part is a required-service addition the compiler reports at every site.

### Open questions

1. **`layerNpm` vs keeping `layer` as an alias.** Renaming is the honest signal; an alias softens the break but preserves the "there is a default" reading this design is trying to kill. Recommend the clean rename.
2. **Should `layerNone` ship?** It is one line and expresses silk's `mode: "none"` and any dry-run consumer, but no in-kit consumer needs it today.
3. **Does `@effected/app` compose this?** If it does, it should default to `layerNpm` explicitly rather than inherit — worth checking during implementation.

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
| `src/PackageManagerName.ts` | The `PackageManagerName` literal, `DetectedPackageManager`, `PackageManagerDetector` service + layer + the `makeTest` / `layerTest` double, `PackageManagerDetectorShape`, `PackageManagerDetectionError` |
| `src/WorkspaceDiscovery.ts` | `WorkspaceInfo`, `WorkspaceDiscovery` service + layer, the `makeTest` / `layerTest` test double, the `workspaceResolver` layer, `WorkspaceDiscoveryError`, `WorkspacePatternError`, `PackageNotFoundError` |
| `src/DependencyGraph.ts` | `DependencyGraph` **value class** (graph + topological sort + cycles), `CyclicDependencyError` |
| `src/ChangeDetector.ts` | `ChangeDetectionOptions`, `ChangeDetector` service + layer (over `@effected/git`'s `Git`), `ChangeDetectionError` |
| `src/WorkspaceCatalogs.ts` | `CatalogSet` class, `WorkspaceCatalogs` service + layer, the `catalogResolver` layer |
| `src/WorkspaceSnapshots.ts` | `WorkspaceSnapshots` service + layers, the snapshot error unions |
| `src/WorkspaceStateSnapshot.ts` | `WorkspaceStateSnapshot` and `PackageStateSnapshot` value classes |
| `src/ConfigDependencyHooks.ts` | `ConfigDependencyHooks` contract service, `layerLive`, `layerNoop`, the `HookInjection` result type (`catalogs` + `releaseAge`) |
| `src/LockfileReader.ts` | `LockfileReader` service + layer (the IO half of `@effected/lockfiles`), `LockfileReadError` |
| `src/Publishability.ts` | `PublishTarget`, `PublishabilityDetectorShape`, `PublishabilityDetector` service + default layer |
| `src/ReleaseTag.ts` | `TagStyle`, `TagFormatOptions`, the `ReleaseTag` value class, the `TrackingTag` alias family with `TrackingTagOptions`, and `classifyTag` / `TagClassification` — a leaf importing nothing else here |
| `src/VersioningStrategy.ts` | `VersioningStrategyType`, `ClassifyOptions`, `VersioningDetectOptions`, `PackageRelease`, the `VersioningStrategy` value class (`classify`, `detect`, `tagsFor`) |
| `src/Workspaces.ts` | The composite layers, `resolverLayer`, `resolveManifest`, `localExecLayer` |
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

#### The standalone and declaration tiers

Those four markers answer "which manager runs this **workspace**". Most repos are not workspaces, and until 2026-07-25 a single-package repo — a `pnpm-lock.yaml`, no `workspaces` field — was **undetectable**, failing typed. That gap is why silk-release-action carried *three* competing hand-rolled detections with two different silent defaults (`"npm"` in `main.ts`, `"pnpm"` in `detect-repo-type.ts`, plus an input-narrowing helper that is not detection at all). Two tiers close it:

- **Standalone** — `pnpm-lock.yaml` → pnpm, a bun lockfile plus a manifest naming bun → bun, `yarn.lock` plus a manifest naming yarn → yarn, `package-lock.json` → npm. The conjunctions **mirror the workspace tier exactly** rather than inventing a looser second rule inside one service: a pnpm or npm lockfile is written by exactly one manager and stands alone, while a stray `yarn.lock` is as common in a single-package repo as in a workspace.
- **Declaration** — no lockfile at all, but `packageManager` or `devEngines.packageManager` names one of the four. A fresh clone before its first install has no lockfile to read and its manifest still says plainly what is meant to run. Weaker evidence, so it is consulted last.

Both tiers run **after every workspace marker has missed**, which makes the widening **strictly additive**: no input that already resolved can change its answer, and a stray `package-lock.json` cannot turn a pnpm workspace into an npm repo. A regression test pins that ordering, because reordering the tiers is the obvious and wrong "simplification".

**The detector still refuses to guess.** Nothing matching is `PackageManagerDetectionError`, never a fabricated default — and the proof that this is the right contract is that the two consumer reimplementations both invented a default here and invented *different* ones. Choosing one is policy, not detection, and a library that makes the choice silently guarantees some caller is wrong. A consumer wanting a default writes `Effect.orElseSucceed` where a reader can see it. `CHECKED` grew to ten markers so the error still names everything it tried.

> **Open, deliberately not changed:** within the workspace tier the npm `workspaces` field is still consulted *before* any standalone lockfile, so a repo with both `workspaces` and a `pnpm-lock.yaml` reports npm. Reordering so lockfile evidence outranks the `workspaces` field would be a behavior change to an already-shipped path rather than an additive one; it is recorded here rather than made silently.

**The detector's double** (2026-07-25) completes the three-service set: `PackageManagerDetector.makeTest(overrides?)` / `layerTest(overrides?)` over the now-exported `PackageManagerDetectorShape`, matching `WorkspaceRoot` and `WorkspaceDiscovery`. **`detect` has no honest default and dies** — the `WorkspaceDiscovery.info` posture, and here the reasoning is sharper than "no default exists": a double that answered `"pnpm"` would contradict the defining property of the service it stands in for, which is that the live detector *refuses to guess*. Failing typed would be the subtler mistake, because `PackageManagerDetectionError` reads as a legitimate "no manager here" answer that a consumer branches on and proceeds past, never learning the test simply forgot to stub. Both wrong shapes are mutation-pinned. Together with the other two `layerTest`s, the whole discovery path now stands up with no filesystem at all.

#### The two fields that declare a manager

Corepack reads **both** the top-level `packageManager` and `devEngines.packageManager`, and they are not interchangeable. `packageManager` is not deprecated; `devEngines` is a validation and fallback layer over it. Corepack validates the two against each other when both are present and falls back to `devEngines.packageManager` when the top-level field is absent. The detector implements:

- **`devEngines.packageManager.name` is authoritative for the NAME.** Corepack *errors* when `packageManager` disagrees with it, so where both are present and disagree, `devEngines` wins. When `devEngines` names a manager, the top-level field's name is not consulted as a disambiguator.
- **The top-level `packageManager` is authoritative for the exact VERSION** — it carries the integrity hash. Where both name the same manager its version wins; where it is absent, `devEngines.packageManager.version` supplies the version.
- A version is reported **only when the field it came from names the manager actually detected.** A `packageManager: "yarn@4"` in a pnpm workspace says nothing about pnpm's version.

Both fields' versions normalize through `@effected/package-json`'s `PackageManager.FromString` (the corepack `name@version+integrity` grammar), so a `devEngines` version carrying a hash reports the same version the top-level field would. A range like `^11` yields none — a range is not a version, and corepack will not run one.

**A malformed manifest hint is ignored, never fatal.** A non-object `devEngines`, a non-object or array `devEngines.packageManager`, a `name` containing `@`, or an unusable version cannot turn a detectable workspace into a detection failure. A manifest that is *present but unreadable or unparseable* is different — it fails with a typed `WorkspaceManifestError`, because a corrupt root manifest is a real problem, not a missing hint. `detect`'s error channel is `PackageManagerDetectionError | WorkspaceManifestError`.

`PackageManagerName` is this package's own literal (`"npm" | "pnpm" | "yarn" | "bun"`). It is structurally identical to `@effected/lockfiles`' `LockfileFormat` and assigns freely to it (which `LockfileReader` relies on), but they are different concepts sharing a carrier, and the name avoids colliding with `@effected/package-json`'s `PackageManager` (the corepack spec class) in a consumer's import list.

### VersioningStrategy and ReleaseTag

Two pure value classes (2026-07-25, github-split Phase 1c) answering the release-shaped questions the workspace model already holds the facts for: *how does this workspace version*, and *what is the git tag called*. They replace `@savvy-web/silk-effects`' `VersioningStrategy` / `TagStrategy` services and silk-release-action's parallel `determine-tag-strategy.ts`.

**Neither is a service, and the kit-wide rule is what settles it** — a service shape carries only effectful members, and both halves here are total pure functions. The v3 originals wrapped classification and formatting in `Effect` with `never` error channels purely to fit a service shape, which is precisely the shape that rule exists to prevent. There is nothing to swap: the two genuinely swappable inputs (`WorkspaceDiscovery`, `PublishabilityDetector`) are already services with their own doubles.

`VersioningStrategy.classify({ packages, fixedGroups? })` is total: `single` (≤ 1 publishable package), `fixed-group` (one group covers the whole publishable set), else `independent`. Two properties are load-bearing and easy to lose: names are **de-duplicated before counting**, or `["a", "a"]` misclassifies a one-package repo as independent and cuts per-package tags for it; and lockstep requires **one single group** to cover the set — two groups covering it between them mean the packages move separately, so a naive "are there any fixed groups?" test is wrong. A group naming non-publishable or nonexistent packages still counts, because groups describe the whole repo rather than the publishable slice.

**`fixedGroups` is a plain argument, never read from a file.** Fixed groups are a release tool's concept — changesets writes them to `.changeset/config.json` — and a workspace-model package that read that file would be adopting one tool's schema and one tool's release policy. A `VersionGroups` contract service (the `CatalogResolver` shape) is the recorded escalation if a second group source ever appears; today there is one, and it lives outside the kit.

`VersioningStrategy.detect(options?)` is the one `Effect.fn`, over `WorkspaceDiscovery | PublishabilityDetector`: enumerate, keep what publishes somewhere, classify. Asking publishability through the service is the point — a consumer honouring a release tool's ignore list swaps the layer rather than filtering afterwards, which is what silk-release-action already does.

`ReleaseTag` is a leaf module importing nothing else in the package. `single` and `scoped` **reproduce production byte for byte**: `1.2.3`, `@scope/pkg@1.2.3`, and `pkg@v1.2.3` for an unscoped name, with `versionPrefix` as the explicit override. The scoped/unscoped `v` asymmetry is **inherited, not designed** — the two v3 implementations disagreed about it and one contradicted its own doc comment, so the kit had to pick, and the one that actually cuts releases won. Git tag history is not an API: pre-1.0 breaking-change freedom covers our code, not a consumer's existing tags. Only a **leading** `@` makes a name scoped, so `weird@name` is not a scope.

**v3's `TagFormatError` is gone.** Its only cause was an empty version, which `Schema.NonEmptyString` now catches during `make`, so formatting is total and every call site sheds an error arm. A bad version reaching these statics is developer wiring rather than untrusted input, so it dies as a defect — the `matchesDependency` posture.

#### TrackingTag — the floating alias family

Release tags are strict SemVer 2 and immutable. **Tracking tags are the deliberately-not-SemVer alias family**: `v1` and `v1.2`, re-pointed at whatever release is newest in that line. This is the GitHub Actions distribution convention — a consumer writes `uses: owner/repo@v1` and gets the newest 1.x.

`TrackingTag` is **its own concept, not a third `TagStyle`**, and the reason is that it is derived *from* a version rather than being a way of formatting one: a release tag names one immutable version, while a tracking tag carries a truncated number that is not a version at all. Folding them together would put a mutable pointer and an immutable name behind one type. It lives in `ReleaseTag.ts` because the classifier below has to know both families, so splitting the modules would force one to import the other anyway.

`TrackingTag.forVersion(version, options?)` derives the set, broadest first, with `packageName` for a monorepo's `@scope/pkg@v1` and `precision: "major"` to skip the minor alias. Three properties are load-bearing:

- **A prerelease derives NOTHING**, and the override (`includePrerelease`) is off by default. Anyone depending on `owner/repo@v1` is asking for the newest *stable* 1.x; re-pointing that alias at `1.0.0-beta.3` ships a prerelease to every such consumer with no signal. Pinned by tests and by two mutants (removing the guard, and treating `+build` as a prerelease).
- **Build metadata is not a prerelease.** `+build` carries no precedence meaning in SemVer, so `1.2.3+sha.abc` is the stable `1.2.3` and derives normally. Stripping build *before* testing for `-` is what makes that correct; the obvious wrong implementation treats any `-`-or-`+` suffix as prerelease, and its own mutant pins it.
- **Derivation is total and never throws.** A version that is not `X.Y.Z` derives nothing, because this is a query about a version rather than a validation of one — and `WorkspacePackage.version` is deliberately tolerant, so odd versions reach here routinely.

0.x versions **do** derive aliases. Floating `v0` across 0.x minors is a genuine hazard, but which aliases to publish is policy decided where tags are moved, not something a derivation should quietly withhold.

**Moving a git tag is not this package's business.** The module derives, formats and parses; re-pointing is a consumer concern over `@effected/git`. That omission is what keeps `ReleaseTag.ts` a pure leaf.

`classifyTag(tag)` answers the recognition half: given any tag string, is it a release tag, a tracking alias, or neither? The families are told apart by **segment count, not by the `v` prefix** — three numeric segments is a version (`1.0.0` and `v1.0.0` are both release tags), one or two is a truncated alias. The `v` *is* required on an alias: a bare `1` is neither valid SemVer nor the convention, and accepting it would make the classifier guess. `unrecognized` is a real answer rather than a failure, because a repository's tags include `latest`, branch names and whatever else humans wrote. Round-tripping is a tested property in both directions — every tag `ReleaseTag` and `TrackingTag` format classifies back to its own family with fields intact — which is what makes the classifier trustworthy rather than a parallel guess that can drift from the producers.

**`@effected/semver` was consciously declined**, matching the call [markdown.md](markdown.md) records for its `$schema` version grammar. The tracking-tag grammar is not SemVer, and the derivation needs only the three numeric segments plus the presence of a prerelease — roughly fifteen lines. A dependency edge for that is disproportionate. It earns itself the day something here needs real semver *comparison* (say, "is this release the newest matching `v1`"), which no caller asks for: choosing what a tracking tag should point at is the consumer's, made where the tag is moved.

`strategy.tagsFor(releases, options?)` folds the two together and is what collapses the consumer's ~110-line `determineTagStrategy` + `isMonorepoForTagging` to two lines. Under `single`/`fixed-group` it returns exactly one tag carrying the **first** release's version; a lockstep batch shares a version by construction, so the choice is visible only on a batch that should not exist. Whether a batch actually agreed is a property of that batch, not of the workspace, so the v3 `isFixedVersioning` flag is deliberately **not** ported — it stays the caller's one-line check.

### PublishabilityDetector

A `Context.Service` deciding whether a package publishes and to where. Its shape is the **exported `PublishabilityDetectorShape` interface**, for symmetry with `WorkspaceDiscoveryShape` — a swappable service whose whole point is that consumers override it must let a consumer *name the type they are implementing* without reaching into the class.

The default layer implements **npm's** semantics, not necessarily anyone's: `private` with no `publishConfig.access` publishes nowhere; an explicit `publishConfig.access` overrides `private`; anything else publishes to the public registry.

**The contract is degrade-or-die**, now stated on the service rather than implied by the signature. `detect`'s error channel is deliberately **`never`**, because every caller — the release planner iterating a whole workspace, most of all — treats "does this publish?" as a **total** question. An overriding layer whose lookup *can* fail therefore has exactly two honest moves: fold the recoverable failure into a safe answer (usually the empty target list), or `Effect.orDie` it into the defect channel. It may not widen the channel the contract declares. Writing this down is the point: the `never` was always load-bearing, but a consumer reading only the signature could mistake it for an accident of the default implementation rather than a rule their layer inherits.

`PublishConfig` gains an optional `linkDirectory` boolean, completing the pnpm-flavored fields the projection carries.

### Ambient cwd is an explicit option

Root resolution is one concern, applied uniformly: every root-consuming layer is `X.layer(options?: { readonly cwd?: string })`, defaulting to `process.cwd()` read lazily at first use (inside `Effect.suspend`, so a `process.chdir` between provide and first call is honoured). No service method reaches for the ambient cwd. A parameterized layer factory mints a fresh reference per call — bind it to a `const` once.

### WorkspaceCatalogs and CatalogSet

`CatalogSet` is the immutable, fully-normalized catalog collection with the one resolution semantic (constructors plus `merge` and `rangeOf`). It carries statics for its three sources: `fromLockfile`, `fromBunBlocks` and `fromManifestWorkspaces`. `WorkspaceCatalogs` assembles it with pnpm's precedence and memoizes. **`internal/catalogs.ts` is the only module that imports `@pnpm/catalogs.*`** — the tier-3 blast radius is one file.

**`WorkspaceCatalogs.releaseAgeGate(): Effect<ReleaseAgeGate, CatalogAssemblyFailure>`** (2026-07-21) assembles the workspace's effective pnpm release-age gate. It folds the inline `pnpm-workspace.yaml` `minimumReleaseAge` / `minimumReleaseAgeExclude` keys and the hook contributions ([ConfigDependencyHooks](#configdependencyhooks--the-opt-in-replay-seam)) through `ReleaseAgeGate.combine` (strictest-wins — [npm.md](npm.md#releaseagegate-the-release-age-gate-vocabulary)), reusing **the same single memoized `assemble` pass** as `set` — one root discovery, one YAML read, one hook replay, both outputs (`CatalogSet` and `ReleaseAgeGate`) memoized together, so the config-dependency code runs exactly once. Present-but-malformed inline release-age values **hard-fail** as `CatalogAssemblyError(source: "manifest")` — the same load-bearing posture as a malformed inline catalog block (a silently-ignored gate is the "install refuses a too-young version the resolver already picked" bug); absent keys contribute nothing. Under the default layer (no-op hooks) the gate sees inline values only; under `layerWithConfigDependencies` it sees both. A bun/npm workspace (no `pnpm-workspace.yaml`) has no release-age keys, so the gate is inert. There is **deliberately no top-level `Workspaces.releaseAgeGate` convenience** — the service method is the surface.

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

`WorkspaceStateSnapshot` is a value class — `packages: ReadonlyArray<PackageStateSnapshot>` (name, version, relative path, the four dependency records) plus `catalogs: CatalogSet` and `importerVersions` (importer path → dependency → recorded version, optional so pre-existing serialized snapshots still decode) — with lazily-built, instance-cached private indexes **outside** the schema (the `DependencyGraph` precedent) backing `versions`, `package(name)`, `resolve(dependency, specifier)` and `resolveIn(importerPath, dependency, specifier)`. `resolve` answers "what did this specifier mean HERE": `workspace:` against this snapshot's package versions, `catalog:` against this snapshot's catalog set. Specifier classification goes through [@effected/npm](npm.md)'s `DependencySpecifier`, and the dependency-section vocabulary comes from npm's consolidated schema. The snapshot is serializable by construction. Beyond `resolve`, a snapshot hands back layers implementing npm's `CatalogResolver` and `WorkspaceResolver` contracts against *itself*, so anything written to the contracts can run "as of" a ref.

**`at(ref)`** reads workspace state at a git ref with no checkout, via `Git.show` and `Git.lsTree`:

- Workspace globs come from `pnpm-workspace.yaml` at the ref, **or** from the root `package.json` `workspaces` field when the YAML is absent. Without this fallback a bun or npm workspace collapses to the root package alone at a ref, and a consumer diffing two snapshots sees every declared dependency as newly added, with no error — a named regression test.
- Package directories come from the compiled `@effected/glob` set matched against `lsTree` entries — the at-ref discovery [glob.md](glob.md) records.
- Each package's `package.json` is read with `show`; a path absent at the ref is skipped (`Option.none` from `Git.show`, never an error).
- Catalogs assemble from the inline source at the ref plus **the detected package manager's own lockfile at the ref**. `Lockfile.parse` is format-aware and both `PnpmExtension` and `BunExtension` carry catalogs. The root manifest's inline bun catalogs are read **unconditionally**, not gated on `bun.lock` presence — gating them reintroduces the "every dep looks added" bug for a bun repo with inline catalogs but a not-yet-committed lockfile. Parity-tested against `worktree()`.

**`worktree()`** reads the live tree over `WorkspaceDiscovery` and `WorkspaceCatalogs`, uncached — the **one** shared read path between worktree snapshots and catalog assembly; there is no second manifest/lockfile read for the worktree.

Mechanics follow the house rules: caching per `(root, ref)` via `Effect.cachedInvalidateWithTTL(Duration.infinity)` with invalidate-on-non-success; a `{ cwd }` option resolving the root by walking up; two named error unions kept narrow — **`WorkspaceSnapshotAtFailure`** (git errors ∪ `CatalogAssemblyError` ∪ `WorkspaceRootNotFoundError`; `at` never enumerates the live filesystem) and **`WorkspaceSnapshotWorktreeFailure`** (discovery errors ∪ `CatalogAssemblyError` ∪ `WorkspaceRootNotFoundError`; `worktree` never invokes git).

**Documented property — at/worktree hook-catalog asymmetry.** `WorkspaceSnapshots.at` never replays config-dependency hooks: it reads inline catalogs plus the lockfile at the ref only. So under `layerWithConfigDependencies`, an `at("HEAD")` snapshot and a `worktree()` snapshot can disagree on hook-injected *catalog sets*. This is deliberate — an at-ref read must not execute historical `pnpmfile.cjs` code.

**The importer-version fallback closes the gap for resolution** (2026-07-24), without touching that asymmetry. A hook-injected catalog is recorded in no committed catalog source — not `pnpm-workspace.yaml`, and not the lockfile `catalogs:` block, since pnpm does not record a peer-only catalog. So a peer declared `catalog:effect:peers` resolved to nothing on *both* sides of a diff, and a real beta bump produced no row and no changeset (reproduced in `type-registry-effect`, Actions run 30130459942). When the catalog set cannot answer a `catalog:` specifier, `resolve` now falls back to the version that ref's **own lockfile importer entry** recorded.

The shape was chosen for symmetry, and the rejected alternatives matter more than the accepted one:

- **Rejected — replay the ref's pinned config dependency.** Network fetch plus arbitrary historical code execution per ref, and impossible for `at(ref)` regardless: it reads through `git show` with no checkout. Switching the default to `layerWithConfigDependencies` fixes only the worktree side and manufactures a bogus `from: "catalog:effect:peers"` → `to: "<version>"` row on every run.
- **Rejected — warn and emit no row.** Leaves the changeset missing, which is the reported defect.
- **Accepted — the lockfile importer fallback.** Both lockfiles are committed, so `at(ref)` and `worktree()` answer identically with no hook replay and no network. Scoped to `catalog:` specifiers only; a plain range is already its own answer. Shipped without an accompanying warning, per the user's call.

Two properties are load-bearing and easy to break: the join is by dependency **name across every field** (pnpm writes a peer into the importer block only when it is also installed, so a `catalog:effect:peers` peer's concrete version sits on that importer's `devDependencies` row), and recorded versions **must** be normalized — `@effected/lockfiles` stores `ImporterDependency.version` verbatim including pnpm's peer suffix, which unstripped renders the whole parenthesized chain as a dependency table's version.

`resolve` is workspace-wide with no importer context, so it answers only when every importer recording that dependency agrees — divergence is `Option.none()`, never a guess. `resolveIn(importerPath, dependency, specifier)` is the precise form for callers holding a `PackageStateSnapshot.relativePath`. `WorkspaceCatalogs.importerVersions()` supplies the live index off the **same** memoized read as `set()`, keeping the one-shared-read-path rule intact.

### ConfigDependencyHooks — the opt-in replay seam

`ConfigDependencyHooks` is a contract service with two layers. `layerLive` does an in-process dynamic `import()` of each config dependency's `pnpmfile.cjs` and replays its `updateConfig` hooks over the inline-catalog seed — in-process code loading, no subprocess. `layerNoop` is the no-execution stand-in.

- **Opt-in by layer choice.** The default `WorkspaceCatalogs.layer` and `Workspaces.layer` wire `layerNoop` — they **never** execute config-dependency code. `layerWithConfigDependencies` opts into `layerLive`.
- **Assembly precedence** is lockfile < inline < hook-injected, merged per-dependency within a catalog, with the hooks seeded by the inline catalogs — matching pnpm's own behavior.
- **Failure is typed, never silent.** A config dependency that fails to load or replay fails with a `"hooks"`-source `CatalogAssemblyError`.
- **Security guard:** `layerLive` rejects a config-dependency name containing a `..` path segment **before** building the `import()` target, so a malicious `configDependencies` entry cannot escape the intended directory.

**`inject` returns a structured `HookInjection`, not bare catalogs** (2026-07-21; breaking pre-`0.1.0`, accepted). The replay now surfaces pnpm's release-age keys alongside the catalogs: `HookInjection { catalogs, releaseAge: PartialReleaseAgeGate }`, exported from the index. A **sibling method** would re-execute config-dependency code — the whole point of the seam is that one replay over one mutable config object yields both outputs, exactly as pnpm replays hooks. `layerNoop` returns `{ catalogs: seed, releaseAge: {} }`.

- **Release-age keys thread last-hook-wins.** `minimumReleaseAge` / `minimumReleaseAgeExclude` are read off the one final threaded config object, so when two hooks both set a key the later write wins — pnpm's single-mutable-config-object behavior.
- **A malformed release-age value is tolerantly dropped**, keeping the prior threaded value — matching the catalog slice's tolerant `configOf`. `CatalogAssemblyError` stays reserved for a load/replay *mechanism* failure, not a hook's returned *data*. The `releaseAge` contribution is a `PartialReleaseAgeGate` because a consumer folds it into an effective gate with `ReleaseAgeGate.combine` alongside the inline values ([npm.md](npm.md#releaseagegate-the-release-age-gate-vocabulary)); hooks setting no release-age keys contribute an empty gate.

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
- Release-age assembly: inline `minimumReleaseAge` / `minimumReleaseAgeExclude` folded through `ReleaseAgeGate.combine`, a malformed inline value hard-failing typed; hook-injected release-age via fixture pnpmfiles (`age-1440`, `age-4320` strictest-wins, `age-garbage` tolerantly dropped); the default no-op layer sees inline only.
- TTL-cache discipline: a failed `at(ref)` init is retried, not memoized.

## Build

Standard per [package-setup.md](../package-setup.md). `savvy.build.ts` carries the narrow `_base` suppression (`{ messageId: "ae-forgotten-export", pattern: "_base" }`) for the synthesized class-factory bases; the gate is a zero-warning `dist/prod/issues.json` with only `*_base` symbols suppressed. The prod gate's expected suppressed count is **31** — 28 plus `ReleaseTag_base`, `VersioningStrategy_base` and `TrackingTag_base` (`suppressed: 0` in the prod gate means the build did not run properly).

The `_base` suppression is scoped to `_base` and nothing else, and Phase 1c demonstrated why: `VersioningStrategy.tagsFor` originally named a module-private `Release` interface on a `@public` signature, and the build reported it as a genuine `ae-forgotten-export` that the narrow pattern correctly did **not** mask. That is real surface a consumer must construct, so it was made `@public` as `PackageRelease` rather than suppressed — the policy's stated boundary, working as intended.
