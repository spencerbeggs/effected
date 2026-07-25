# @effected/workspaces

Monorepo workspace tooling as Effect services: workspace root discovery, package enumeration, the dependency graph, package-manager detection, pnpm catalog resolution, lockfile IO and git-based change detection. What remains of `workspaces-effect` after `@effected/lockfiles` took the parsers and `@effected/glob` took pattern matching.

**Design doc:** `@../../.claude/design/effected/packages/workspaces.md` — load when changing the enumerator, the error model, or any service contract.

## Tier

**Integrated**, and the `@pnpm/catalogs.*` quartet is why. Those four packages *are* pnpm's catalog semantics, versioned to pnpm majors; reimplementing them means owning a moving spec with no oracle. They are confined to `src/internal/catalogs.ts` — **the only module that may import them**, so the tier-3 blast radius is one file.

Other runtime deps are `workspace:~` edges: `@effected/git`, `@effected/glob`, `@effected/lockfiles`, `@effected/walker`, `@effected/yaml`, `@effected/package-json`, `@effected/npm`. `effect` is a peer.

**`minimatch` is not a dependency and must not become one.** Both v3 call sites — `WorkspacePackage.matchesDependency` and the `packages:` enumerator — run on `@effected/glob`'s vendored engine.

## Public surface

`src/index.ts` is the only re-exporting module, and the package ships a **second entry**, `@effected/workspaces/node-sync` (`src/node-sync.ts`) — the node-bound preset for the sync entry points (`nodeFileSystem`, `nodePath`, `nodeSyncOps`). It is a separate subpath **deliberately**: the main entry imports nothing platform-shaped, and `index.ts` must never re-export it or `node:` imports leak into every consumer. Fifteen concept modules:

- `WorkspacePackage.ts` — `WorkspacePackage`, `PublishConfig`, `DependencyDiff`, `WorkspaceManifestError`
- `WorkspaceRoot.ts` — `WorkspaceRoot` service + layer + test double (`makeTest` / `layerTest`), `WorkspaceRootShape`, `WORKSPACE_MARKERS`, `FindWorkspaceRootOptions`, `WorkspaceRootNotFoundError`
- `PackageManagerName.ts` — `PackageManagerName`, `DetectedPackageManager`, `PackageManagerDetector`, `PackageManagerDetectionError`
- `WorkspaceDiscovery.ts` — `WorkspaceDiscovery`, `WorkspaceInfo`, three errors, the `workspaceResolver` layer, and the test double (`makeTest` / `layerTest`: empty-workspace defaults derived from the effective `listPackages`; `info` dies unless stubbed)
- `DependencyGraph.ts` — `DependencyGraph` (a **value class**, not a service), `CyclicDependencyError`
- `ChangeDetector.ts` — `ChangeDetector`, `ChangeDetectionOptions`, `ChangeDetectionError`, `ChangeDetectionFailure`
- `WorkspaceSnapshots.ts` — `WorkspaceSnapshots` (`at(ref)` / `worktree()`), plus the `WorkspaceSnapshotAtFailure` / `WorkspaceSnapshotWorktreeFailure` unions
- `WorkspaceStateSnapshot.ts` — `WorkspaceStateSnapshot`, `PackageStateSnapshot`
- `WorkspaceCatalogs.ts` — `CatalogSet`, `WorkspaceCatalogs` (with `releaseAgeGate()` and `importerVersions()`), `ImporterVersions`, the `catalogResolver` layer, the `CatalogAssemblyFailure` type union
- `ConfigDependencyHooks.ts` — `ConfigDependencyHooks` contract, `HookInjection`, `layerNoop` / `layerLive`
- `LockfileReader.ts` — `LockfileReader`, `LockfileReadError`
- `Publishability.ts` — `PublishabilityDetector`, `PublishTarget`
- `ReleaseTag.ts` — `ReleaseTag`, `TagStyle`, `TagFormatOptions`, plus the floating-alias family `TrackingTag` / `TrackingTagOptions` and the recognizer `classifyTag` / `TagClassification` (all **value classes**, not services; a leaf importing nothing else here)
- `VersioningStrategy.ts` — `VersioningStrategy` (a **value class**: `classify` / `detect` / `tagsFor`), `VersioningStrategyType`, `ClassifyOptions`, `VersioningDetectOptions`, `PackageRelease`
- `Workspaces.ts` — the composite layers (`layer`, `layerWithConfigDependencies`, `layerWithGit`, `resolvers`) plus the one-call manifest path (`resolverLayer`, `resolveManifest`)
- `WorkspacesSync.ts` — `findWorkspaceRootSync`, `getWorkspacePackagesSync` over consumer-supplied `SyncFileSystem` / `SyncPath` ops
- `node-sync.ts` — the node-bound ops preset (`node:fs` / `node:path`), published only under the `./node-sync` subpath

**`CatalogAssemblyError` moved to `@effected/npm`** (beside the contract that names it in its channel) and is deliberately **not re-exported** here — import it from `@effected/npm`. `catalogResolver` passes assembly failures through **typed** as that error, no longer folded into a `DependencyResolutionError` defect `cause`; only an unfindable workspace root still wraps as `DependencyResolutionError`.

## The things that will bite you

### The `packages:` enumerator (workspaces issue #62)

v3's `glob-core.ts` silently rewrote a trailing `/**` to `/*`, so `packages/**` matched one level and a nested package went undiscovered with **no diagnostic**. `internal/enumerate.ts` is the fix: `GlobSet` classifies the pattern set, `GlobPattern.crossesSegments` picks a single-level read vs. a **bounded iterative descent**, `enumerationPrefix` says where to start. The descent is a **worklist, not a recursion** (cannot overflow), bounded by `maxDepth` (integer-guarded: `NaN` and `2.5` are **defects** — a bare `depth < maxDepth` admits both, then enumerates nothing, indistinguishable from a legitimate empty result), a visit budget, and an unconditional `node_modules` / `.git` prune.

`WorkspacesSync` shares that logic properly: both entry points drive **one traversal state machine**, `internal/traverse.ts`, which owns the dequeue order (a head index, never `Array.shift()`), the depth rule, the visit budget and the prune list. **Do not let either entry point re-decide any of them** — two hand-written copies is exactly how they drifted (the sync copy once returned a package one level past the cap the Effect enumerator rejected). The only deliberate difference is at the bound: Effect fails typed, sync truncates; `__test__/WorkspacesSync.test.ts` drives both against one tree at the boundary. The sync module itself imports **nothing platform-shaped**: both entry points are **positional-path-first, options second** — `findWorkspaceRootSync(cwd, options)` / `getWorkspacePackagesSync(root, options)` (issue #110 unified them; `cwd` is required, so the module no longer reads an ambient `process.cwd()`), the options bag carrying consumer-supplied `fileSystem` + `path` ops (`node:fs` / `node:path` satisfy them one-liner each), so Windows correctness is the consumer passing a win32-appropriate `path` — the `TsconfigLoaderSync` convention.

### pnpm writes MULTI-DOCUMENT lockfiles — and framing is NOT this package's job

pnpm 11 emits `pnpm-lock.yaml` as **two YAML documents** when the workspace uses `configDependencies` — a config-dependency preamble, then the real one (this repo's own lockfile is that shape). A first-document parse silently returns the *preamble* and looks like an empty workspace, not a failure. `@effected/lockfiles` owns the framing as of its #58 (the real lockfile is the **last** document; a stream with none fails typed as `LockfileFramingError`), so `LockfileReader` just calls `Lockfile.parse`. The earlier richest-document-wins workaround here (`internal/documents.ts` + a local `parseLockfileText`) was **deleted** when #58 landed — do not reintroduce it.

### `Effect.cached` would brick every layer

Every lazy init uses `Effect.cachedInvalidateWithTTL` + `Effect.onExit`-invalidate-on-non-success, **not** `Effect.cached`. `Effect.cached` memoizes the first `Exit` *including an interrupt*, so an init interrupted by an unrelated timeout permanently poisons the layer with a cause outside its declared error channel. Success is memoized; failures and interrupts are retried.

### Change detection runs on `@effected/git`, not a local git seam

`GitReader` is **gone** — the module and its `GitCommandError` were deleted. `ChangeDetector` now runs on `@effected/git`'s `Git` service: `changedFiles(root, { base, head, relative: true })` for the committed range, `workingChanges(root, { relative: true })` for `includeUncommitted`, unioned and sorted. Every query uses `relative: true` so paths come back relative to the workspace root — correct even when the workspace is nested inside a larger git repository. A non-repository surfaces as git's own `NotARepositoryError` (not re-wrapped); `ChangeDetectionFailure` carries git's typed errors alongside `ChangeDetectionError` and the discovery failures. `Git` requires core's `ChildProcessSpawner` in `R`, discharged by the consumer's platform layer at the edge; a test provides `Layer.succeed(Git, …)` and needs no repository on disk. Nothing NEW may build a local subprocess seam — go through `@effected/git`.

### Tracking tags never float onto a prerelease

`TrackingTag.forVersion("1.0.0-beta.3")` returns `[]`, and that is the point of the function, not an edge case. Anyone depending on `owner/repo@v1` is asking for the newest **stable** 1.x; re-pointing `v1` at a beta ships a prerelease to every such consumer silently. `includePrerelease: true` exists for callers who genuinely mean it and should be rare.

Two related traps: **`+build` is NOT a prerelease** (`1.2.3+sha.abc` is the stable 1.2.3 and derives normally, so build metadata must be stripped *before* the `-` test — the obvious wrong version treats any `-`-or-`+` suffix as prerelease), and **derivation is total** (junk yields `[]`, never a throw — `WorkspacePackage.version` is deliberately tolerant, so odd versions arrive here routinely). Each has its own mutation-pinned test.

`classifyTag` tells the two families apart by **segment count, not the `v`**: three numeric segments is a version, one or two is an alias. The `v` is required on an alias — accepting a bare `1` would make the classifier guess, which is the one thing it exists not to do. `unrecognized` is a real answer; a repo's tags include `latest` and branch names.

**`@effected/semver` is deliberately not a dependency here.** The tracking grammar is not semver and the derivation needs ~15 lines (three numeric segments + is there a prerelease). Take the edge only if something needs real semver *comparison*; formatting and recognition do not.

### `PackageManagerDetector` REFUSES to guess — do not give it a default

Its chain runs three tiers: the workspace markers, then a standalone tier (`pnpm-lock.yaml`, `package-lock.json`, and the bun/yarn lockfiles under the **same** manifest conjunction the workspace tier uses), then a declaration tier (`packageManager` / `devEngines.packageManager` with no lockfile at all — a fresh clone before its first install). Nothing matching is `PackageManagerDetectionError`.

**Adding a fallback default is the tempting wrong fix.** silk-release-action did it twice and picked *different* defaults each time — `"npm"` in `main.ts`, `"pnpm"` in `detect-repo-type.ts` — which is the proof that the choice is policy, not detection: whichever a library picks, some caller is silently wrong. A consumer that wants one writes `Effect.orElseSucceed` at its own call site, visibly.

The standalone and declaration tiers run **last**, so the widening is strictly additive — no previously-resolving input can change its answer, and a stray `package-lock.json` cannot turn a pnpm workspace into an npm repo. `__test__/PackageManagerDetector.test.ts` pins that ordering; reordering the tiers is the obvious and wrong "simplification".

### The ascent is bounded on request

`find(cwd, options?)` takes `{ stopAt, maxDepth }`, both passed **straight
through to `Walker.ascend`** — walker already owned both concepts, so nothing
was reinvented here. `stopAt` is inclusive (the ceiling is itself probed) and is
`path.resolve`d first: walker compares it to each ancestor by string equality,
so an unresolved ceiling would never match and would silently degrade to the
unbounded ascent the option exists to prevent. An unmarked ceiling fails typed
with `stopAt` recorded on the error, which is what distinguishes "no root
anywhere above me" from "none below my ceiling". `findWorkspaceRootSync` has
**not** been given the same bounds — see the surface note below.

`WorkspaceRoot.makeTest(root)` / `layerTest(root)` are the sanctioned double —
consumers were writing nine copies of
`Layer.succeed(WorkspaceRoot, { find: () => Effect.succeed("/repo") })`. The
double **honours `stopAt`**: a hand-rolled `find` that ignores the ceiling makes
a bounded call pass under test and fail live, which is the very failure `stopAt`
exists to catch. It deliberately does NOT model `maxDepth` — it never walks, so
there is no depth to cap and pretending otherwise would encode a fiction.
`WorkspaceRootShape` is exported so a consumer can type a bespoke double against
the contract instead of re-deriving it.

### `WorkspacePackage` is deliberately tolerant

It does **not** embed `@effected/package-json`'s `Package`: that model requires a strict `SemVer`, so one member with an odd version would fail discovery for the whole repo. `WorkspacePackage.manifest` is the opt-in bridge to the strict model — an `Effect.fn` **static** carrying the named span, with a thin instance wrapper (`pkg.manifest()`) that just delegates to it. It deliberately **re-reads** the file, a point-in-time refresh; for tolerant access to fields outside the typed discovery slice (`scripts`, `exports`, …) without a second read, `manifestRecord` captures the as-read `package.json` record (values `unknown`; defaults to `{}` for values serialized before the field existed).

`workspaceRoot` is a **required carried field**, not a derived getter. Discovery
resolved the root before enumerating and the sync entry point is handed it, so
dropping it was pure information loss — downstream consumers were reconstructing
it by counting `relativePath` segments and re-ascending that many `..`.

It is required **on purpose, and it is the one breaking change here**: a
`WorkspacePackage` serialized before the field existed now fails decode. That
contradicts the compat posture `manifestRecord` set (old wire values stay
valid), and the asymmetry is deliberate — `{}` is an honest "no record", but
there is no honest default root. A placeholder would hand back a wrong absolute
path that consumers resolve config against, silently reading the wrong
`.changeset/config.json`, which is the bug the field exists to kill. Both halves
are asserted in `WorkspacePackage.test.ts`; failing decode is the conservative
direction because re-running discovery is cheap.

## Ambient cwd

Root resolution is **one concern**: every root-consuming layer takes `{ cwd }`, defaulting to `process.cwd()` read lazily inside `Effect.suspend`. No service method reaches for the ambient cwd. The layer factories are parameterized, so **bind them to a `const`** — layers memoize by reference.

The deliberate exception is `Workspaces.resolverLayer(options?)`: a **fresh, unmemoized layer per call is the feature** — each call re-runs root discovery (including a per-call `process.cwd()` read), so a build tool that changes directory between manifests stays correct. It wires the pnpmfile-replay path (`layerWithConfigDependencies`); compose `Workspaces.resolvers` with `Workspaces.layer` yourself if config-dependency code must not run. `Workspaces.resolveManifest(manifest, options?)` runs `@effected/npm`'s `Manifest.resolve()` over a fresh `resolverLayer` — decode with `Manifest.decode` at the edge, and check the pure `manifest.needsResolution` first to skip catalog assembly entirely.

## Testing

`Path.layer` and `FileSystem.layerNoop` come from `effect` core, so the whole suite runs on a virtual filesystem with no platform package. `__test__/fixtures.ts` builds one from a `Tree` record. A suite-boundary `layer(...)` cannot vary per test, so **each distinct tree gets its own `layer(...)` block**.

The one exception is `__test__/integration/self.int.test.ts`, which discovers **this repository** through `@effect/platform-node` (a devDependency). It is the only test that proves the whole stack composes against a real pnpm workspace — and it is what caught the multi-document lockfile bug.

365 tests across `__test__/`. `savvy.build.ts` carries the narrow `_base` suppression (`{ messageId: "ae-forgotten-export", pattern: "_base" }`) for the 31 synthesized error/schema-class bases in the prod `issues.json` (`CatalogAssemblyError`'s base moved out with it; `ReleaseTag`'s, `VersioningStrategy`'s and `TrackingTag`'s arrived with Phase 1c); never widen it. The narrow scoping is load-bearing, not ceremony: `VersioningStrategy.tagsFor` named a module-private interface on a `@public` signature and the build flagged it as a genuine `ae-forgotten-export` the `_base` pattern correctly refused to mask — the fix was exporting the type (`PackageRelease`), never widening the pattern. Never run `node savvy.build.ts --target prod` directly — build through `pnpm build --filter @effected/workspaces`.

## Point-in-time surface (as built)

The v3 deferrals are now shipped (piece 3, 2026-07-15); `silk-update-action` and `savvy-web/systems` are the declared consumers. Design lives in the design doc's "v2 additions" section — load it before touching any of this. The decorative `PackageName` / `WorkspacePath` brands stay dropped.

### `WorkspaceSnapshots` — "what did this workspace look like then"

`at(ref)` reads workspace state at a git ref with **no checkout**, entirely over `Git`: package dirs come from `Git.lsTree` matched against the compiled `@effected/glob` set (no directory descent), manifests via `Git.show`. Every workspace-relative path handed to `Git.show` is **`./`-prefixed** (the manifest, the `pnpm-workspace.yaml`, each member `./<dir>/package.json`, and the lockfile) so git resolves it relative to `cwd` — the resolved workspace root — aligning with `Git.lsTree`, which already emits cwd-relative paths. A **bare** path resolves relative to the git repo TOP-LEVEL, so a workspace root nested inside a larger repo would read the OUTER manifest and drop or misread its members; `__test__/integration/WorkspaceSnapshotsNested.int.test.ts` is the nested-repo regression guard. `Git.show`'s contract is unchanged — the `./` is this reader's explicit choice, not a service change. When `pnpm-workspace.yaml` is absent at the ref, patterns and catalogs fall back to the root `package.json` `workspaces` field (c594ff1) — without it a bun/npm workspace collapses to the root package alone and a diff reads every dependency as newly added. Results cache per `(resolved root, ref)` via `Effect.cachedInvalidateWithTTL` at `Duration.infinity`, invalidated on any non-success exit (never bare `Effect.cached`). `worktree()` reads the live tree over the **one shared** `WorkspaceDiscovery` + `WorkspaceCatalogs` path — no second read.

`WorkspaceStateSnapshot` is a serializable value (`packages`, `catalogs`, `importerVersions`) with lazy `#private` indexes: `versions`, `package(name)`, `resolve(dependency, specifier)` (classified through `@effected/npm`'s `DependencySpecifier`, never prefix-sniffed), `resolveIn(importerPath, dependency, specifier)`, and the snapshot-scoped `catalogResolver` / `workspaceResolver` / `resolvers` layers answering `@effected/npm`'s contracts as of that snapshot. `PackageStateSnapshot` is the narrower per-member slice. Failure unions: `WorkspaceSnapshotAtFailure` (git errors + `CatalogAssemblyError` from the inline source + `WorkspaceRootNotFoundError`; a malformed *lockfile* at the ref degrades to no catalogs) and `WorkspaceSnapshotWorktreeFailure` (never touches git).

### A hook-injected catalog resolves through the lockfile IMPORTERS, not a hook replay

A `catalog:` specifier injected by a pnpm config-dependency pnpmfile hook (`"effect": "catalog:effect:peers"`) is recorded in **neither** committed source a snapshot reads: the workspace declares no such catalog, and pnpm does not record a **peer-only** catalog in the lockfile's `catalogs:` block. Both sides of a before/after diff then resolved it to the same raw string, so a genuine beta bump produced no row and no changeset — reproduced in `type-registry-effect` (Actions run 30130459942).

The fix is `internal/importerVersions.ts`: when the catalog set cannot answer a `catalog:` specifier, fall back to the version that ref's **own lockfile importer entry** recorded. Three things about it are load-bearing:

- **Never replay the hook to fix this.** `WorkspaceSnapshots.at(ref)` reads through `git show` with no checkout and can never execute a past ref's pnpmfile, so `layerWithConfigDependencies` fixes only the worktree side. The asymmetry manufactures a bogus `from: "catalog:effect:peers"` → `to: "<version>"` row on **every** run. Both lockfiles are committed, which is the whole reason this shape was chosen.
- **The join is by dependency NAME, across every dependency field.** pnpm writes a peer into the importer block only when it is also installed, so the concrete version for a `catalog:effect:peers` peer lives on that importer's `devDependencies` row. Joining by field, or by matching the recorded specifier, finds nothing.
- **Importer versions are raw and MUST be normalized.** `@effected/lockfiles` stores `ImporterDependency.version` verbatim, peer suffix included (`4.0.0-beta.101(effect@4.0.0-beta.101)(ioredis@5.11.1(...))`). Unstripped, that whole chain lands in a consumer's dependency table as the version. `link:`/`file:` entries are skipped — a filesystem edge is not a version.

`resolve` is workspace-wide and has no importer context, so it answers only when **every** importer recording that dependency agrees; divergence yields `Option.none()` rather than a wrong answer. `resolveIn(importerPath, …)` is the precise form for callers that know the importer (`PackageStateSnapshot.relativePath`, `"."` for root). The fallback fires for `catalog:` specifiers **only** — a plain range is already its own answer.

### Catalog assembly is PM-aware

`WorkspaceCatalogs` picks its inline reader by **file presence**: `pnpm-workspace.yaml` selects the pnpm blocks; its absence selects bun's root `package.json` `workspaces.catalog` / `workspaces.catalogs`. The lockfile source is PM-aware too — `CatalogSet.fromLockfile` reads whichever extension (pnpm or bun) the parsed lockfile carries. New `CatalogSet` statics: `fromLockfile`, `fromBunBlocks`, `fromManifestWorkspaces`. Both **live** inline readers **hard-fail** on a malformed catalog block or a default catalog declared twice (top-level `catalog` *and* `catalogs.default` for pnpm; `workspaces.catalog` *and* `workspaces.catalogs.default` for bun) — a silently-empty catalog is the "every dependency looks newly added" bug. The two paths share one validator (`validatedCatalogBlocks`), so they fail typed on exactly the same conditions rather than one hard-failing and the other normalizing to `{}`. The at-ref readers (`CatalogSet.fromWorkspaceYaml`, `bunInlineCatalogs`) are deliberately **tolerant** of the same shapes; that asymmetry is intentional. The presence probe itself distinguishes genuine absence from a probe FAILURE: a non-NotFound `PlatformError` from `fs.exists` (a permission/IO error) fails typed rather than collapsing to "absent" and selecting the wrong reader.

`WorkspaceCatalogs.releaseAgeGate()` returns an `Effect<ReleaseAgeGate, CatalogAssemblyFailure>`: inline `pnpm-workspace.yaml` release-age keys and hook contributions are combined **strictest-wins** in the **same single memoized assemble pass** as the catalogs. Malformed inline values **hard-fail** typed as `CatalogAssemblyError(source: "manifest")` — the same posture as inline catalog blocks. There is deliberately **no** top-level `Workspaces` convenience.

### `ConfigDependencyHooks` — opt-in pnpmfile replay

A pnpm config dependency's pnpmfile `updateConfig` hook can mutate catalogs; replaying it executes config-dependency code, so it is gated. `layerLive` dynamically `import()`s each config dependency's pnpmfile **in process** (no subprocess) and replays it; `layerNoop` returns `{ catalogs: seed, releaseAge: {} }` untouched.

`ConfigDependencyHooks.inject` returns a `HookInjection { catalogs, releaseAge: PartialReleaseAgeGate }` — **one replay, both outputs**. Release-age keys thread **last-hook-wins**; malformed hook values are tolerantly dropped (`CatalogAssemblyError` stays mechanism-only). `HookInjection` is exported from `index.ts`. The **default** `WorkspaceCatalogs.layer` / `Workspaces.layer` wire `layerNoop` — the default path provably runs no config-dependency code; opting in is explicit via `WorkspaceCatalogs.layerWithConfigDependencies` / `Workspaces.layerWithConfigDependencies`. A `..` segment in a config-dependency name, or a hook that fails to load or replay, fails typed as a `hooks`-source `CatalogAssemblyError` — never a silent skip.

The pnpmfile is loaded by trying `pnpmfile.mjs` **first** (pnpm 11 ships the config-dependency pnpmfile as an ES module — a pnpm-11-native config dep may carry only `.mjs`) and falling back to `pnpmfile.cjs` (legacy); `import()` loads both. The "no pnpmfile" skip is keyed on the dynamic `import()` raising `ERR_MODULE_NOT_FOUND` **for the candidate file itself** — discriminated by comparing Node's `err.url` (the offending module's URL) against the candidate URL, so an `ERR_MODULE_NOT_FOUND` for a module the pnpmfile *imports* surfaces typed rather than being mistaken for an absent file. There is **no `existsSync` precheck** (it returns false for an existing-but-inaccessible file and would silently skip a real hook); any other load failure surfaces typed. `internal/catalogs.ts` stays the only `@pnpm/catalogs.*` importer.
