# @effected/workspaces

Monorepo workspace tooling as Effect services: workspace root discovery, package enumeration, the dependency graph, package-manager detection, pnpm catalog resolution, lockfile IO and git-based change detection. What remains of `workspaces-effect` after `@effected/lockfiles` took the parsers and `@effected/glob` took pattern matching.

**Design doc:** `@../../.claude/design/effected/packages/workspaces.md` — load when changing the enumerator, the error model, or any service contract.

## Tier

**Integrated**, and the `@pnpm/catalogs.*` quartet is why. Those four packages *are* pnpm's catalog semantics, versioned to pnpm majors; reimplementing them means owning a moving spec with no oracle. They are confined to `src/internal/catalogs.ts` — **the only module that may import them**, so the tier-3 blast radius is one file.

Other runtime deps are `workspace:*` edges: `@effected/git`, `@effected/glob`, `@effected/lockfiles`, `@effected/walker`, `@effected/yaml`, `@effected/package-json`, `@effected/npm`. `effect` is a peer.

**`minimatch` is not a dependency and must not become one.** Both v3 call sites — `WorkspacePackage.matchesDependency` and the `packages:` enumerator — run on `@effected/glob`'s vendored engine.

## Public surface

`src/index.ts` is the only re-exporting module. Fourteen concept modules:

- `WorkspacePackage.ts` — `WorkspacePackage`, `PublishConfig`, `DependencyDiff`, `WorkspaceManifestError`
- `WorkspaceRoot.ts` — `WorkspaceRoot` service + layer, `WORKSPACE_MARKERS`, `WorkspaceRootNotFoundError`
- `PackageManagerName.ts` — `PackageManagerName`, `DetectedPackageManager`, `PackageManagerDetector`, `PackageManagerDetectionError`
- `WorkspaceDiscovery.ts` — `WorkspaceDiscovery`, `WorkspaceInfo`, three errors, the `workspaceResolver` layer
- `DependencyGraph.ts` — `DependencyGraph` (a **value class**, not a service), `CyclicDependencyError`
- `ChangeDetector.ts` — `ChangeDetector`, `ChangeDetectionOptions`, `ChangeDetectionError`, `ChangeDetectionFailure`
- `WorkspaceSnapshots.ts` — `WorkspaceSnapshots` (`at(ref)` / `worktree()`), plus the `WorkspaceSnapshotAtFailure` / `WorkspaceSnapshotWorktreeFailure` unions
- `WorkspaceStateSnapshot.ts` — `WorkspaceStateSnapshot`, `PackageStateSnapshot`
- `WorkspaceCatalogs.ts` — `CatalogSet`, `WorkspaceCatalogs`, the `catalogResolver` layer, the `CatalogAssemblyFailure` type union
- `ConfigDependencyHooks.ts` — `ConfigDependencyHooks` contract, `layerNoop` / `layerLive`
- `LockfileReader.ts` — `LockfileReader`, `LockfileReadError`
- `Publishability.ts` — `PublishabilityDetector`, `PublishTarget`
- `Workspaces.ts` — the composite layers (`layer`, `layerWithConfigDependencies`, `layerWithGit`, `resolvers`) plus the one-call manifest path (`resolverLayer`, `resolveManifest`)
- `WorkspacesSync.ts` — `findWorkspaceRootSync`, `getWorkspacePackagesSync` over consumer-supplied `SyncFileSystem` / `SyncPath` ops

**`CatalogAssemblyError` moved to `@effected/npm`** (beside the contract that names it in its channel) and is deliberately **not re-exported** here — import it from `@effected/npm`. `catalogResolver` passes assembly failures through **typed** as that error, no longer folded into a `DependencyResolutionError` defect `cause`; only an unfindable workspace root still wraps as `DependencyResolutionError`.

## The things that will bite you

### The `packages:` enumerator (workspaces issue #62)

v3's `glob-core.ts` silently rewrote a trailing `/**` to `/*`, so `packages/**` matched one level and a nested package went undiscovered with **no diagnostic**. `internal/enumerate.ts` is the fix: `GlobSet` classifies the pattern set, `GlobPattern.crossesSegments` picks a single-level read vs. a **bounded iterative descent**, `enumerationPrefix` says where to start. The descent is a **worklist, not a recursion** (cannot overflow), bounded by `maxDepth` (integer-guarded: `NaN` and `2.5` are **defects** — a bare `depth < maxDepth` admits both, then enumerates nothing, indistinguishable from a legitimate empty result), a visit budget, and an unconditional `node_modules` / `.git` prune.

`WorkspacesSync` shares that logic properly: both entry points drive **one traversal state machine**, `internal/traverse.ts`, which owns the dequeue order (a head index, never `Array.shift()`), the depth rule, the visit budget and the prune list. **Do not let either entry point re-decide any of them** — two hand-written copies is exactly how they drifted (the sync copy once returned a package one level past the cap the Effect enumerator rejected). The only deliberate difference is at the bound: Effect fails typed, sync truncates; `__test__/WorkspacesSync.test.ts` drives both against one tree at the boundary. The sync module itself imports **nothing platform-shaped**: each entry point takes a single options bag carrying consumer-supplied `fileSystem` + `path` ops (a breaking signature change; `findWorkspaceRootSync`'s optional `cwd` rides on the bag, no positional argument; `node:fs` / `node:path` satisfy the ops one-liner each), so Windows correctness is the consumer passing a win32-appropriate `path` — the `TsconfigLoaderSync` convention.

### pnpm writes MULTI-DOCUMENT lockfiles — and framing is NOT this package's job

pnpm 11 emits `pnpm-lock.yaml` as **two YAML documents** when the workspace uses `configDependencies` — a config-dependency preamble, then the real one (this repo's own lockfile is that shape). A first-document parse silently returns the *preamble* and looks like an empty workspace, not a failure. `@effected/lockfiles` owns the framing as of its #58 (the real lockfile is the **last** document; a stream with none fails typed as `LockfileFramingError`), so `LockfileReader` just calls `Lockfile.parse`. The earlier richest-document-wins workaround here (`internal/documents.ts` + a local `parseLockfileText`) was **deleted** when #58 landed — do not reintroduce it.

### `Effect.cached` would brick every layer

Every lazy init uses `Effect.cachedInvalidateWithTTL` + `Effect.onExit`-invalidate-on-non-success, **not** `Effect.cached`. `Effect.cached` memoizes the first `Exit` *including an interrupt*, so an init interrupted by an unrelated timeout permanently poisons the layer with a cause outside its declared error channel. Success is memoized; failures and interrupts are retried.

### Change detection runs on `@effected/git`, not a local git seam

`GitReader` is **gone** — the module and its `GitCommandError` were deleted. `ChangeDetector` now runs on `@effected/git`'s `Git` service: `changedFiles(root, { base, head, relative: true })` for the committed range, `workingChanges(root, { relative: true })` for `includeUncommitted`, unioned and sorted. Every query uses `relative: true` so paths come back relative to the workspace root — correct even when the workspace is nested inside a larger git repository. A non-repository surfaces as git's own `NotARepositoryError` (not re-wrapped); `ChangeDetectionFailure` carries git's typed errors alongside `ChangeDetectionError` and the discovery failures. `Git` requires core's `ChildProcessSpawner` in `R`, discharged by the consumer's platform layer at the edge; a test provides `Layer.succeed(Git, …)` and needs no repository on disk. Nothing NEW may build a local subprocess seam — go through `@effected/git`.

### `WorkspacePackage` is deliberately tolerant

It does **not** embed `@effected/package-json`'s `Package`: that model requires a strict `SemVer`, so one member with an odd version would fail discovery for the whole repo. `WorkspacePackage.manifest` is the opt-in bridge to the strict model — an `Effect.fn` **static** carrying the named span, with a thin instance wrapper (`pkg.manifest()`) that just delegates to it. It deliberately **re-reads** the file, a point-in-time refresh; for tolerant access to fields outside the typed discovery slice (`scripts`, `exports`, …) without a second read, `manifestRecord` captures the as-read `package.json` record (values `unknown`; defaults to `{}` for values serialized before the field existed).

## Ambient cwd

Root resolution is **one concern**: every root-consuming layer takes `{ cwd }`, defaulting to `process.cwd()` read lazily inside `Effect.suspend`. No service method reaches for the ambient cwd. The layer factories are parameterized, so **bind them to a `const`** — layers memoize by reference.

The deliberate exception is `Workspaces.resolverLayer(options?)`: a **fresh, unmemoized layer per call is the feature** — each call re-runs root discovery (including a per-call `process.cwd()` read), so a build tool that changes directory between manifests stays correct. It wires the pnpmfile-replay path (`layerWithConfigDependencies`); compose `Workspaces.resolvers` with `Workspaces.layer` yourself if config-dependency code must not run. `Workspaces.resolveManifest(manifest, options?)` runs `@effected/npm`'s `Manifest.resolve()` over a fresh `resolverLayer` — decode with `Manifest.decode` at the edge, and check the pure `manifest.needsResolution` first to skip catalog assembly entirely.

## Testing

`Path.layer` and `FileSystem.layerNoop` come from `effect` core, so the whole suite runs on a virtual filesystem with no platform package. `__test__/fixtures.ts` builds one from a `Tree` record. A suite-boundary `layer(...)` cannot vary per test, so **each distinct tree gets its own `layer(...)` block**.

The one exception is `__test__/integration/self.int.test.ts`, which discovers **this repository** through `@effect/platform-node` (a devDependency). It is the only test that proves the whole stack composes against a real pnpm workspace — and it is what caught the multi-document lockfile bug.

230 tests across `__test__/`. `savvy.build.ts` carries the narrow `_base` suppression (`{ messageId: "ae-forgotten-export", pattern: "_base" }`) for the 28 synthesized error/schema-class bases in the prod `issues.json` (`CatalogAssemblyError`'s base moved out with it); never widen it. Never run `node savvy.build.ts --target prod` directly — build through `pnpm build --filter @effected/workspaces`.

## Point-in-time surface (as built)

The v3 deferrals are now shipped (piece 3, 2026-07-15); `silk-update-action` and `savvy-web/systems` are the declared consumers. Design lives in the design doc's "v2 additions" section — load it before touching any of this. The decorative `PackageName` / `WorkspacePath` brands stay dropped.

### `WorkspaceSnapshots` — "what did this workspace look like then"

`at(ref)` reads workspace state at a git ref with **no checkout**, entirely over `Git`: package dirs come from `Git.lsTree` matched against the compiled `@effected/glob` set (no directory descent), manifests via `Git.show`. Every workspace-relative path handed to `Git.show` is **`./`-prefixed** (the manifest, the `pnpm-workspace.yaml`, each member `./<dir>/package.json`, and the lockfile) so git resolves it relative to `cwd` — the resolved workspace root — aligning with `Git.lsTree`, which already emits cwd-relative paths. A **bare** path resolves relative to the git repo TOP-LEVEL, so a workspace root nested inside a larger repo would read the OUTER manifest and drop or misread its members; `__test__/integration/WorkspaceSnapshotsNested.int.test.ts` is the nested-repo regression guard. `Git.show`'s contract is unchanged — the `./` is this reader's explicit choice, not a service change. When `pnpm-workspace.yaml` is absent at the ref, patterns and catalogs fall back to the root `package.json` `workspaces` field (c594ff1) — without it a bun/npm workspace collapses to the root package alone and a diff reads every dependency as newly added. Results cache per `(resolved root, ref)` via `Effect.cachedInvalidateWithTTL` at `Duration.infinity`, invalidated on any non-success exit (never bare `Effect.cached`). `worktree()` reads the live tree over the **one shared** `WorkspaceDiscovery` + `WorkspaceCatalogs` path — no second read.

`WorkspaceStateSnapshot` is a serializable value (`packages`, `catalogs`) with lazy `#private` indexes: `versions`, `package(name)`, `resolve(dependency, specifier)` (classified through `@effected/npm`'s `DependencySpecifier`, never prefix-sniffed), and the snapshot-scoped `catalogResolver` / `workspaceResolver` / `resolvers` layers answering `@effected/npm`'s contracts as of that snapshot. `PackageStateSnapshot` is the narrower per-member slice. Failure unions: `WorkspaceSnapshotAtFailure` (git errors + `CatalogAssemblyError` from the inline source + `WorkspaceRootNotFoundError`; a malformed *lockfile* at the ref degrades to no catalogs) and `WorkspaceSnapshotWorktreeFailure` (never touches git).

### Catalog assembly is PM-aware

`WorkspaceCatalogs` picks its inline reader by **file presence**: `pnpm-workspace.yaml` selects the pnpm blocks; its absence selects bun's root `package.json` `workspaces.catalog` / `workspaces.catalogs`. The lockfile source is PM-aware too — `CatalogSet.fromLockfile` reads whichever extension (pnpm or bun) the parsed lockfile carries. New `CatalogSet` statics: `fromLockfile`, `fromBunBlocks`, `fromManifestWorkspaces`. Both **live** inline readers **hard-fail** on a malformed catalog block or a default catalog declared twice (top-level `catalog` *and* `catalogs.default` for pnpm; `workspaces.catalog` *and* `workspaces.catalogs.default` for bun) — a silently-empty catalog is the "every dependency looks newly added" bug. The two paths share one validator (`validatedCatalogBlocks`), so they fail typed on exactly the same conditions rather than one hard-failing and the other normalizing to `{}`. The at-ref readers (`CatalogSet.fromWorkspaceYaml`, `bunInlineCatalogs`) are deliberately **tolerant** of the same shapes; that asymmetry is intentional. The presence probe itself distinguishes genuine absence from a probe FAILURE: a non-NotFound `PlatformError` from `fs.exists` (a permission/IO error) fails typed rather than collapsing to "absent" and selecting the wrong reader.

### `ConfigDependencyHooks` — opt-in pnpmfile replay

A pnpm config dependency's pnpmfile `updateConfig` hook can mutate catalogs; replaying it executes config-dependency code, so it is gated. `layerLive` dynamically `import()`s each config dependency's pnpmfile **in process** (no subprocess) and replays it; `layerNoop` returns the inline seed untouched. The **default** `WorkspaceCatalogs.layer` / `Workspaces.layer` wire `layerNoop` — the default path provably runs no config-dependency code; opting in is explicit via `WorkspaceCatalogs.layerWithConfigDependencies` / `Workspaces.layerWithConfigDependencies`. A `..` segment in a config-dependency name, or a hook that fails to load or replay, fails typed as a `hooks`-source `CatalogAssemblyError` — never a silent skip.

The pnpmfile is loaded by trying `pnpmfile.mjs` **first** (pnpm 11 ships the config-dependency pnpmfile as an ES module — a pnpm-11-native config dep may carry only `.mjs`) and falling back to `pnpmfile.cjs` (legacy); `import()` loads both. The "no pnpmfile" skip is keyed on the dynamic `import()` raising `ERR_MODULE_NOT_FOUND` **for the candidate file itself** — discriminated by comparing Node's `err.url` (the offending module's URL) against the candidate URL, so an `ERR_MODULE_NOT_FOUND` for a module the pnpmfile *imports* surfaces typed rather than being mistaken for an absent file. There is **no `existsSync` precheck** (it returns false for an existing-but-inaccessible file and would silently skip a real hook); any other load failure surfaces typed. `internal/catalogs.ts` stays the only `@pnpm/catalogs.*` importer.
