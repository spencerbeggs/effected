# @effected/workspaces

Monorepo workspace tooling as Effect services: workspace root discovery, package enumeration, the dependency graph, package-manager detection, pnpm catalog resolution, lockfile IO and git-based change detection. What remains of `workspaces-effect` after `@effected/lockfiles` took the parsers and `@effected/glob` took pattern matching.

**Design doc:** `@../../.claude/design/effected/packages/workspaces.md` — load when changing the enumerator, the error model, or any service contract.

## Tier

**Integrated**, and the `@pnpm/catalogs.*` quartet is why. Those four packages *are* pnpm's catalog semantics, versioned to pnpm majors; reimplementing them means owning a moving spec with no oracle. They are confined to `src/internal/catalogs.ts` — **the only module that may import them**, so the tier-3 blast radius is one file.

Other runtime deps are `workspace:*` edges: `@effected/glob`, `@effected/lockfiles`, `@effected/walker`, `@effected/yaml`, `@effected/package-json`, `@effected/npm`. `effect` is a peer.

**`minimatch` is not a dependency and must not become one.** Both v3 call sites — `WorkspacePackage.matchesDependency` and the `packages:` enumerator — run on `@effected/glob`'s vendored engine.

## Public surface

`src/index.ts` is the only re-exporting module. Thirteen concept modules:

- `WorkspacePackage.ts` — `WorkspacePackage`, `PublishConfig`, `DependencyDiff`, `WorkspaceManifestError`
- `WorkspaceRoot.ts` — `WorkspaceRoot` service + layer, `WORKSPACE_MARKERS`, `WorkspaceRootNotFoundError`
- `PackageManagerName.ts` — `PackageManagerName`, `DetectedPackageManager`, `PackageManagerDetector`, `PackageManagerDetectionError`
- `WorkspaceDiscovery.ts` — `WorkspaceDiscovery`, `WorkspaceInfo`, three errors, the `workspaceResolver` layer
- `DependencyGraph.ts` — `DependencyGraph` (a **value class**, not a service), `CyclicDependencyError`
- `GitReader.ts` — `GitReader` contract, `GitReader.layerNode`, `GitCommandError`
- `ChangeDetector.ts` — `ChangeDetector`, `ChangeDetectionOptions`, `ChangeDetectionError`
- `WorkspaceCatalogs.ts` — `CatalogSet`, `WorkspaceCatalogs`, `CatalogAssemblyError`, the `catalogResolver` layer
- `LockfileReader.ts` — `LockfileReader`, `LockfileReadError`
- `Publishability.ts` — `PublishabilityDetector`, `PublishTarget`
- `Workspaces.ts` — the composite layers (`layer`, `layerWithGit`, `resolvers`)
- `WorkspacesSync.ts` — `findWorkspaceRootSync`, `getWorkspacePackagesSync`

## The things that will bite you

### The `packages:` enumerator (workspaces issue #62)

v3's `glob-core.ts` silently rewrote a trailing `/**` to `/*`, so `packages/**` matched one level and a nested package went undiscovered with **no diagnostic**. `internal/enumerate.ts` is the fix: `GlobSet` classifies the pattern set, `GlobPattern.crossesSegments` decides between a single-level read and a **bounded iterative descent**, and `enumerationPrefix` says where to start.

The descent is a **worklist, not a recursion** — it cannot overflow, so there is no stack cap to get wrong. It is bounded by `maxDepth` (integer-guarded: `NaN` and `2.5` are **defects**, because a bare `depth < maxDepth` admits both and then enumerates nothing, which is indistinguishable from a legitimate empty result), a visit budget, and an unconditional `node_modules` / `.git` prune.

`WorkspacesSync` does not merely "share the same worklist" — both entry points drive **one traversal state machine**, `internal/traverse.ts`, which owns the dequeue order (a head index, never `Array.shift()`), the depth rule, the visit budget and the prune list. **Do not let either entry point re-decide any of them.** Two hand-written copies is exactly how they drifted: the sync copy accepted a child before checking its depth and returned a package one level past the cap that the Effect enumerator rejected on the same tree. The only deliberate difference is at a bound — Effect fails typed, sync truncates — and `__test__/WorkspacesSync.test.ts` drives both against one real tree at the boundary, because a test that exercises one entry point cannot catch this class of drift.

### pnpm writes MULTI-DOCUMENT lockfiles — and framing is NOT this package's job

pnpm 11 emits `pnpm-lock.yaml` as **two YAML documents** when the workspace uses `configDependencies` — a config-dependency preamble, then the real one. This repo's own lockfile is that shape, and a first-document parse silently returns the *preamble*: a handful of packages, no workspace importers, no catalogs. It looks like an empty workspace, not a failure.

`@effected/lockfiles` owns this as of its #58, on a deterministic rule: pnpm's writer always emits the preamble as a **prefix**, so the real lockfile is the **last** document. A stream carrying no lockfile document fails typed as a `LockfileFramingError`. `LockfileReader` therefore just calls `Lockfile.parse`. An earlier richest-document-wins workaround here (`internal/documents.ts` + a local `parseLockfileText`) was **deleted** when #58 landed — do not reintroduce it.

### `Effect.cached` would brick every layer

Every lazy init uses `Effect.cachedInvalidateWithTTL` + `Effect.onExit`-invalidate-on-non-success, **not** `Effect.cached`. `Effect.cached` memoizes the first `Exit` *including an interrupt*, so an init interrupted by an unrelated timeout permanently poisons the layer with a cause outside its declared error channel. Success is memoized; failures and interrupts are retried.

### GitReader predates core's subprocess API and is dissolving

`GitReader` was built when this package believed v4 core had no subprocess API. That premise is now false — core ships `effect/unstable/process` (`ChildProcess` + `ChildProcessSpawner`), and `@effected/git` builds on it — so `GitReader` is a legacy seam: still the module `ChangeDetector` runs on **today**, but scheduled to dissolve when the workspaces point-in-time piece retargets `ChangeDetector` onto `@effected/git`'s `Git` service (see the Deferred section below). Until then: `GitReader.layerNode` is the `node:child_process` default, tests mock it with `Layer.succeed` (change detection tests need no git repository), and nothing NEW may be built on it — new subprocess needs go through core's contract.

### `WorkspacePackage` is deliberately tolerant

It does **not** embed `@effected/package-json`'s `Package`: that model requires a strict `SemVer`, so one member with an odd version would fail discovery for the whole repo. `WorkspacePackage.manifest(pkg)` is the opt-in bridge to the strict model — a **static**, not an instance method (`static readonly manifest = Effect.fn(...)(function* (self: WorkspacePackage))`), so `pkg.manifest()` does not exist.

## Ambient cwd

Root resolution is **one concern**: every root-consuming layer takes `{ cwd }`, defaulting to `process.cwd()` read lazily inside `Effect.suspend`. No service method reaches for the ambient cwd. The layer factories are parameterized, so **bind them to a `const`** — layers memoize by reference.

## Testing

`Path.layer` and `FileSystem.layerNoop` come from `effect` core, so the whole suite runs on a virtual filesystem with no platform package. `__test__/fixtures.ts` builds one from a `Tree` record. A suite-boundary `layer(...)` cannot vary per test, so **each distinct tree gets its own `layer(...)` block**.

The one exception is `__test__/integration/self.int.test.ts`, which discovers **this repository** through `@effect/platform-node` (a devDependency). It is the only test that proves the whole stack composes against a real pnpm workspace — and it is what caught the multi-document lockfile bug.

## Deferred from v3 — revised 2026-07-14

Two of the three v1 deferrals are revoked and **on the `0.1.0` gate**, with `silk-update-action` and `savvy-web/systems` as the declared consumers: git at-ref snapshots return as `WorkspaceSnapshots` (designed, not yet implemented), and the pnpmfile `configDependencies` hook replay returns behind an opt-in seam — the default `WorkspaceCatalogs` layer still never executes config-dependency code. The decorative `PackageName` / `WorkspacePath` brands stay dropped. The same design round dissolves `GitReader` into core's `ChildProcessSpawner` contract (`effect/unstable/process`, provided by the consumer's platform layer) + `@effected/git` (`Git`); `ChangeDetector` re-targets `Git`, and `GitReader.ts`'s opening "core ships NO Command" comment is stale — false at beta.97, it dies with the module. Design in the design doc's "v2 additions" section — load it before touching any of this.
