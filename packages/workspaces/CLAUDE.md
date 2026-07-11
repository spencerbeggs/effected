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

`WorkspacesSync` shares the same `GlobSet` and the same worklist. **Do not let it grow a private pattern semantic** — that is exactly what v3 did, in defiance of glob-core's own anti-drift mandate. The integration suite pins the two against each other.

### pnpm writes MULTI-DOCUMENT lockfiles

pnpm 11 emits `pnpm-lock.yaml` as **two YAML documents** when the workspace uses `configDependencies` — a config-dependency lockfile, then the real one. This repo's own lockfile is that shape. `@effected/lockfiles` is pure and parses one document, so a single-document parse silently returns the *preamble*: a handful of packages, no workspace importers, no catalogs. It looks like an empty workspace, not a failure.

`internal/documents.ts` + `parseLockfileText` in `LockfileReader.ts` select the richest document. **Framing is the file-reader's job**, which is why the fix lives here and not in the pure package — but the underlying single-document assumption in `@effected/lockfiles` is worth revisiting upstream.

### `Effect.cached` would brick every layer

Every lazy init uses `Effect.cachedInvalidateWithTTL` + `Effect.onExit`-invalidate-on-non-success, **not** `Effect.cached`. `Effect.cached` memoizes the first `Exit` *including an interrupt*, so an init interrupted by an unrelated timeout permanently poisons the layer with a cause outside its declared error channel. Success is memoized; failures and interrupts are retried.

### No subprocess API in Effect v4 core

There is no `Command` / `CommandExecutor` (`Stdio` is the current process's streams, not spawning). `GitReader` is our own contract; `GitReader.layerNode` is the `node:child_process` default. Tests mock it with `Layer.succeed`, which is why change detection tests need no git repository.

### `WorkspacePackage` is deliberately tolerant

It does **not** embed `@effected/package-json`'s `Package`: that model requires a strict `SemVer`, so one member with an odd version would fail discovery for the whole repo. `pkg.manifest()` is the opt-in bridge to the strict model.

## Ambient cwd

Root resolution is **one concern**: every root-consuming layer takes `{ cwd }`, defaulting to `process.cwd()` read lazily inside `Effect.suspend`. No service method reaches for the ambient cwd. The layer factories are parameterized, so **bind them to a `const`** — layers memoize by reference.

## Testing

`Path.layer` and `FileSystem.layerNoop` come from `effect` core, so the whole suite runs on a virtual filesystem with no platform package. `__test__/fixtures.ts` builds one from a `Tree` record. A suite-boundary `layer(...)` cannot vary per test, so **each distinct tree gets its own `layer(...)` block**.

The one exception is `__test__/integration/self.int.test.ts`, which discovers **this repository** through `@effect/platform-node` (a devDependency). It is the only test that proves the whole stack composes against a real pnpm workspace — and it is what caught the multi-document lockfile bug.

## Deferred from v3

`PointInTimeWorkspace` / `WorkspaceStateSnapshot` (git at-ref snapshots), the pnpmfile `configDependencies` hook replay, and the decorative unused `PackageName` / `WorkspacePath` brands. Reasons in the design doc; none are on the release gate.
