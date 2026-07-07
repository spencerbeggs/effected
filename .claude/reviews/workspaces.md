# Review: workspaces-effect → @effected/workspaces

Source: `/Users/spencer/workspaces/spencerbeggs/workspaces-effect` (v2.0.1, Effect 3.21.4, @effect/platform 0.96.2)
Target: `@effected/workspaces` (Effect v4-first redesign) with candidate extraction `@effected/lockfiles`
Standards: `.claude/design/effected/effect-standards.md`

This is a mature, well-documented v3 library — 11 services, 15 error types, 4 lockfile parsers, ~8,200 lines including tests. The review judges design, not v3 idioms.

---

## 1. What is done well (preserve in the v4 redesign)

### API design

- **Uniform service contract discipline.** Every service resolves its dependencies at layer construction so all methods have `R = never`. This is exactly the "deps in layer, not in method signatures" rule and it is applied without exception across all 11 services.
- **Precise, documented error unions per method.** `LockfileInitError`, `PointInTimeAtError`, `PointInTimeWorktreeError`, `PointInTimeReadError` are exported type aliases with TSDoc explaining *why* each member can or cannot occur ("`worktree` never invokes git, so `GitReadError` cannot occur"). This is best-in-class typed-error DX and maps directly onto the v4 error ladder.
- **Rich domain classes, not bags of data.** `WorkspacePackage` (computed getters `isRootWorkspace`, `scope`, `unscopedName`, `allDependencies`; instance methods `hasAnyDependencyOn`, `dependencyVersion`, `dependencyDiff`) is already the semver-effect-style class-based DX the standards name as north star. `CatalogSet` (static constructors `empty`/`fromCatalogs`/`fromWorkspaceYaml`/`fromLockfileCatalogs`/`merge`, instance `resolveSpecifier`) and `WorkspaceStateSnapshot` (lazily built instance-cached indexes via `#private` fields that deliberately sit outside the schema and never encode) are exemplary schema-class value objects. Port these nearly verbatim.
- **Two composite layers split on platform requirements.** `WorkspacesLive` (FileSystem + Path) vs `WorkspacesFullLive` (+ CommandExecutor) is a great consumer story: the requirement set, not an arbitrary feature flag, is the split axis. All layers are bound to constants (memoization-correct).
- **Progressive disclosure.** `ChangeDetector.changedFiles → changedPackages → affectedPackages` gives three analysis depths on one service. Keep this shape.
- **Documented swappability.** The README shows replacing `PublishabilityDetector` with `Layer.succeed` for org-specific publish semantics — the layer-DI value proposition made concrete.

### Engineering patterns

- **Lazy init + memoization.** `Effect.cached` wraps the heavy first-call I/O (root find, PM detect, read, parse) so layer construction is O(1), with init errors surfacing from each method's E channel as the exported union. The pattern and its rationale (per-call-site layer construction in Vitest reporters/CLIs) are documented. This survives v4 unchanged.
- **"One semantic, two producers."** `glob-core.ts` is the single workspace-glob compiler shared by live discovery and at-ref discovery ("both producers MUST route pattern interpretation through here so their semantics cannot drift"); `resolveManifest` is the single catalog-resolution semantic shared by the live `CatalogResolver` and snapshot `CatalogSet.resolveSpecifier`. This anti-drift discipline is a design asset — carry it forward explicitly.
- **`GitReader` correctness.** `cat-file -e` existence probe before `show` (so absent-at-ref is `Option.none`, never an error), locale-pinned `LC_ALL=C` stderr classification, concurrent stdout/stderr draining with the documented race rationale, per-command timeout. Hard-won; port as-is into `src/internal/`.
- **Unified lockfile model.** `LockfileData` normalizes four formats, with PM-specific residue in a `pmSpecific` discriminated union (`PnpmExtension | BunExtension`) instead of polluting the common shape. Parsers follow a clean pipeline: text parse → `Schema.decodeUnknown` raw-format validation → transform to the unified model.
- **Observability already at standard.** Consistent `Effect.withSpan("Service.operation")` names, namespaced `workspace.*` log annotations, Debug-level-only default silence, and a README section on wiring loggers — this matches the standards' library/application division. The existing span names become the `Effect.fn` names one-for-one.
- **Honest documentation.** Extensive TSDoc, a 9-document `docs/` set, and limitation notes that state exactly what does not work (one-level glob expansion, un-installed `configDependencies` invisibility). Preserve the content even as the file layout changes.

## 2. What is confusing or awkward (do not carry forward)

- **Kind-based folder sprawl.** `errors/` (15 one-class files), `schemas/`, `services/`, `layers/`, `utils/` — the exact layout the standards supersede. Cost is visible everywhere: each service's contract and implementation live in two files with substantially duplicated TSDoc (`LockfileReader.ts` + `LockfileReaderLive.ts`); `index.ts` is 200 lines of re-export bookkeeping; public types leak from awkward paths (`ManifestLike` from `layers/catalog/resolve.js`, `workspaceManifestFromYaml` from `layers/catalog/workspace-manifest.js` — public API exported from a "layers" implementation directory).
- **The `*ErrorBase` workaround.** Every error exports a `Data.TaggedError("X")` base constant purely for api-extractor DTS bundling, doubling the exported error surface (30 exports for 15 errors). `Schema.TaggedErrorClass` plus the monorepo's build pipeline eliminates this entirely.
- **The `declare static` + index.ts wiring hack.** `WorkspacePackage` declares nine static methods that are *assigned at module load in index.ts* to dodge a circular import — a circularity created by the kind-based layout itself (`utils/workspace-package.ts` imports `schemas/core.ts`). Worse, each query exists **three times**: instance method, `Function.dual` static, and the standalone util export. In module-per-concept the file owns its methods and the hack evaporates. Recommend dropping the dual data-first/data-last statics entirely — the README's own example (`packages.filter(pipe(WorkspacePackage.hasAnyDependencyOn("react")))`) shows the pipeable form adds nothing over instance methods on a class-based API.
- **Decorative brands.** `PackageName` and `WorkspacePath` branded schemas are defined, exported, and documented — and used by *nothing*: `WorkspacePackage.name/path` are plain `NonEmptyString`. Either apply brands to the domain model or delete them; shipping unused brands is API noise.
- **Ambient `process.cwd()` defaults, inconsistently overridable.** `LockfileReaderLive` and `CatalogResolverLive` hard-code `process.cwd()` in their init; `WorkspaceDiscovery` and `PointInTimeWorkspace` accept per-call `cwd`; `LockfileReader` and `CatalogResolver` do not. In v4, make root resolution one explicit concern (a config/option on the layer, or a shared `WorkspaceContext`), applied uniformly.
- **Post-hoc pnpm name resolution.** The pnpm parser emits workspace packages named by importer *path* with version `"0.0.0"`, and `LockfileReaderLive` then re-reads every `package.json` and *rebuilds* the packages and dependency edges with real names. Normalization is split across parser and reader — a confusing seam and a blocker for clean extraction. Redesign: pass the workspace manifest set into parsing so the parser emits final names, or model "importer-keyed" vs "name-resolved" as two explicit stages.
- **`Request`/`RequestResolver` over-engineering.** `resolvedVersion` wraps a `Map.get` on an already-memoized index in a request cache with 1-minute TTL and a tagged request class. There is no batching win (single-key resolver) and nothing to deduplicate that `Effect.cached` hasn't already. Delete in the redesign; same question for the equivalent machinery in `DependencyGraphLive`.
- **Error proliferation at the margins.** The core lockfile ladder (Read/Parse/Integrity) is well-judged, but: `GitNotAvailableError` vs `GitReadError` overlap (one live consumer); `CatalogAssemblyError` vs `CatalogResolutionError` distinction is subtle enough to need remarks blocks; `PackageJsonParseError` collapses causes to strings (`"schema decode failed"`), destroying ParseError detail — the standards require `cause: Schema.Defect` and boundary `SchemaError` normalization instead.
- **`TopologicalSorter` and `PackageResolver` are over-granular services.** Sorting is a pure function of the graph — `sort`/`sortSubset`/`levels` belong as `DependencyGraph` methods (or statics on a graph value object). `PackageResolver` (file → owning package) is a lookup over discovery output; it exists as a service mainly so `ChangeDetector` can depend on it. Both are candidates for folding.
- **Three glob semantics after all.** Despite glob-core's anti-drift mandate, `sync.ts` hand-rolls its own YAML pattern scraping (`parsePnpmPatterns`) and its own pattern expansion (`resolvePattern`) that doesn't share glob-core (no `?` support, different negation handling path). The sync escape hatch is legitimate; its private reimplementation of pattern semantics is not.
- **Platform purity is only mostly true.** README claims "no `node:` imports leak into your code", but `sync.ts` (exported from the main entry) imports `node:fs`/`node:path`, and `config-dependency-hooks.ts` uses `node:module`/`node:url` for dynamic pnpmfile import. Both are justifiable — but they should be acknowledged as boundary-tier facts and isolated (separate `./sync` subpath export; documented Node-only overlay).
- **Test harness is pre-`@effect/vitest`.** Plain `it()` + `Effect.runPromise`/`Effect.exit` with `Effect.provide(...)` repeated in each test body. The mock layers themselves (`__test__/utils/layers.ts` — typed `Layer.succeed` fakes, no `as any`) are good and reusable; the harness must move to `it.effect` + top-level `layer(...)` grouping per the standards.

## 3. v4 migration implications (this codebase specifically)

| v3 construct (here) | v4 target | Notes |
| --- | --- | --- |
| `Context.Tag("@spencerbeggs/...")<Id, Shape>` classes in `services/` + separate `Layer.effect` in `layers/` | `Context.Service` class with co-located layer(s) in one concept file | Kills the services/layers duplication and the doubled TSDoc; tag identifiers become `@effected/workspaces/X` |
| `Data.TaggedError` + exported `*ErrorBase` const + `get message()` | `Schema.TaggedErrorClass` with message and `cause: Schema.Defect` fields | ErrorBase workaround deleted; `LockfileParseError.cause: unknown` and `PackageJsonParseError.cause: string` become schema-backed defect fields |
| `Schema.Class` models (`WorkspacePackage`, `CatalogSet`, `WorkspaceStateSnapshot`, `LockfileData`, ...) | `Schema.Class` (v4) | Shape survives; construction changes `new X({...})` → `X.make(...)` everywhere (parsers, sync.ts, tests); `Schema.optional` → `Schema.optionalKey` for omissible fields; `optionalWith(default)` → v4 default mechanism |
| `Schema.NonEmptyString.pipe(Schema.brand(...))` | `Schema.brand` / `.check(...)` (v4) — but only if actually applied to the model | Decide: brand `name`/`path` fields for real, or drop the brands |
| `@effect/platform` `FileSystem`/`Path`/`Command`/`CommandExecutor` imports | effect core platform abstractions (v4 merges platform into `effect`; catalog has no plain `@effect/platform`) | Peer set shrinks to `effect` alone; consumers provide `@effect/platform-node`/`-bun` at the edge as today |
| Anonymous `Effect.gen` bodies + `Effect.withSpan("X.y")` | `Effect.fn("X.y")(function*(){...})` | The span-name discipline already exists; this is a mechanical rename that *upgrades* observability (stack frames) |
| `Effect.cached` lazy-init with exported init-error unions | Same pattern, unchanged | One of the strongest carryovers |
| `Request.TaggedClass` + `RequestResolver` + request cache | Delete | See §2; plain memoized lookup suffices |
| `Schema.decodeUnknown(X)` + `Effect.mapError(() => new DomainError(...))` | `Schema.decodeUnknownEffect` + `Effect.catchTag("SchemaError", ...)` normalization preserving the ParseError as `cause` | Current code throws away decode detail |
| `Schema.Class` for options (`ChangeDetectionOptions` with defaults) | Same, constructed via `.make` | Nice existing pattern — options-as-schema gives validated defaults |
| `yaml-effect` / `jsonc-effect` / `semver-effect` deps | `@effected/yaml` / `@effected/jsonc` / `@effected/semver` via `workspace:*` | All three source repos are already in the migration inventory |
| plain vitest + `Effect.runPromise` | `@effect/vitest` `it.effect`, `layer(...)` group provisioning, `Schema.toArbitrary` property tests for parsers | Parser tests (fixture-string → LockfileData) are ideal `it.effect` conversions; the lockfile fixtures directory ports as-is |

Semantics to re-verify at port time: v4 Schema default/optional encoding behavior for the `optionalWith(default)`-heavy classes, and the v4 equivalents of `Effect.cached` and platform `Command` streaming used by `GitReader`.

## 4. Candidate module-per-concept layout

### @effected/workspaces

| File | Owns |
| --- | --- |
| `src/index.ts` | Re-exports only |
| `src/WorkspacePackage.ts` | `WorkspacePackage` class (instance methods absorbed from `utils/workspace-package.ts`; `readPackageJson` as an Effect-returning method/static), `PublishConfig`, `PackageJson` schema, `DependencyDiff`, `PackageJsonParseError` |
| `src/WorkspaceRoot.ts` | `WorkspaceRoot` service + layer, `WorkspaceInfo`, `WorkspaceRootNotFoundError` |
| `src/PackageManager.ts` | `PackageManager` literal schema, `PackageManagerDetector` service + layer, `DetectedPackageManager`, `PackageManagerDetectionError` |
| `src/WorkspaceDiscovery.ts` | Service + layer, `WorkspaceDiscoveryError`, `PackageNotFoundError` |
| `src/DependencyGraph.ts` | Service + layer **including** `sort`/`sortSubset`/`levels` (TopologicalSorter folded in), `CyclicDependencyError`, `DependencyResolutionError`; fold `PackageResolver`'s file→package lookup here or into ChangeDetector |
| `src/ChangeDetector.ts` | `ChangeDetectionOptions`, service + layer, `ChangeDetectionError`, `GitNotAvailableError` (or merge into `GitReadError`) |
| `src/Publishability.ts` | `PublishTarget`, `PublishabilityDetector` service + layer |
| `src/Catalog.ts` | `CatalogSet` class, `CatalogResolver` service + layer, `CatalogAssemblyError`, `CatalogResolutionError`, `ManifestLike` |
| `src/WorkspaceSnapshot.ts` | `PackageStateSnapshot`, `WorkspaceStateSnapshot`, `PointInTimeWorkspace` service + layer, `GitReadError`, the three error unions |
| `src/Workspaces.ts` | Composite layers (`Workspaces.layer`, `Workspaces.layerFull` or equivalent) |
| `src/Sync.ts` | Sync escape hatch, exposed as a **separate `./sync` subpath export** so the main entry stays `node:`-free; pattern logic shared with `internal/globCore` |
| `src/internal/` | `gitReader.ts`, `globCore.ts`, `catalogAssemble.ts`, `catalogResolve.ts`, `configDependencyHooks.ts`, `workspaceManifest.ts` |

### @effected/lockfiles (extracted)

| File | Owns |
| --- | --- |
| `src/Lockfile.ts` | `LockfileData` (consider renaming `Lockfile`) with a static `parse(content, format)` dispatcher, `ResolvedPackage`, `WorkspaceDependency`, `LockfileFormat` literal, `LockfileParseError`, `LockfileReadError` |
| `src/PnpmLockfile.ts`, `src/NpmLockfile.ts`, `src/YarnLockfile.ts`, `src/BunLockfile.ts` | Per-format raw schema + parser (or demote raw schemas to `internal/` if the raw shapes stay private) |
| `src/LockfileIntegrity.ts` | Integrity report class, `LockfileIntegrityError`, and a **pure** check function taking manifests as input (see §5) |
| `src/internal/` | shared extraction helpers (`extractWorkspaceDeps`, specifier classification) |

## 5. Extraction / split / seam candidates

- **Lockfile parsers → @effected/lockfiles: the seam is clean and the extraction is right.** The four parsers are pure `string → Effect<LockfileData, LockfileParseError>` functions with zero service dependencies; `schemas/lockfile.ts` is self-contained except for the `PackageManager` literal (trivially moved). Dependencies that travel: `@effected/yaml` (pnpm, yarn), `@effected/jsonc` (bun). Two seam repairs needed first:
  1. **pnpm name resolution** (§2) must move out of `LockfileReaderLive` — either parsers accept an optional importer-path→name map, or the two-stage model is made explicit. Otherwise @effected/lockfiles ships half a normalization.
  2. **Integrity checking** (`layers/integrity.ts`, needs `@effected/semver`) currently takes `(lockfileData, root, fs, path)` and reads package.json files itself. Refactor to a pure `(lockfileData, manifests) → LockfileIntegrity` in @effected/lockfiles (pure tier), with @effected/workspaces supplying the manifest I/O. That keeps @effected/lockfiles peer-depending on `effect` only.
  - The `LockfileReader` *service* (root find + PM detect + read + dispatch) stays in @effected/workspaces, consuming `@effected/lockfiles` via `workspace:*`.
  - `CatalogSet.fromLockfileCatalogs` consumes the pnpm `catalogs:` record shape — define that record type in @effected/lockfiles so workspaces doesn't re-declare it.
- **Catalog machinery is the second-most separable concept.** `layers/catalog/*` + `CatalogSet` + `CatalogResolver` carry the entire `@pnpm/catalogs.*` dependency footprint (4 packages pinned `^1100.0.0` — pnpm internals versioned to pnpm majors, the riskiest deps in the package) plus the Node-only pnpmfile hook replay. Keeping it one concept module (`Catalog.ts` + internals) contains that risk; promotion to `@effected/pnpm-catalogs` is defensible later but not required now.
- **`GitReader` is a latent shared component.** Its own comments reference the same decision made in silk-effects' `runGitShow`. If any other @effected package needs at-ref file reads, promote to a tiny internal-shared or `@effected/git` package; until then, `internal/gitReader.ts`.
- **`sync.ts`** — keep (the lint-staged use case is real) but as a `./sync` subpath export, sharing `globCore` so the third pattern semantic disappears.
- **`minimatch`** is imported for exactly one method (`WorkspacePackage.matchesDependency`). A globCore-style compiled regex covers the documented use cases and drops a runtime dependency.

## 6. Peer / dependency hygiene

Current state (v3):

- **Peers: `effect`, `@effect/platform`** — correct and complete for v3; `@effect/platform-node` is devDependency-only (tests), so no platform adapter leaks into the runtime closure. Good.
- **Transitive peer closure:** `yaml-effect@0.7.2`, `jsonc-effect@0.3.0`, `semver-effect@0.3.1` are *regular* dependencies, each peering on `effect ^3.21.0`. Their peers resolve at the consumer's importer — exactly the systems#228 / vitest-agent#127 escape pattern the standards warn about. It happens to be safe here because workspaces-effect's own `effect` peer is range-compatible, but it is implicit, not declared. In the monorepo these become `@effected/*` `workspace:*` edges and the question is decided per edge at design time (likely peers, so a single `effect` instance is guaranteed).
- **`@pnpm/catalogs.*` ×4 at `^1100.0.0`** — heaviest and fastest-moving external surface; see §5 for containment.
- **`minimatch: ">=10.2.3"`** — open-ended `>=` range is a hazard (future majors auto-accepted); should be `^` — or removed per §5.
- **v4 target:** with platform merged into effect core, the peer closure for both @effected/workspaces (boundary tier) and @effected/lockfiles (pure tier) collapses to `effect` alone, plus `workspace:*` edges to `@effected/{yaml,jsonc,semver,lockfiles}`. `catalog:silk`/`catalog:silkPeers` references get replaced by the effected monorepo's catalog entries.

---

## Verdict

The library's *semantics* — service contracts, error unions, lazy init, the value-object trio (`WorkspacePackage`, `CatalogSet`, `WorkspaceStateSnapshot`), GitReader, the unified lockfile model — are strong and largely v4-shaped already. The *packaging* — kind-based folders, ErrorBase workarounds, the static-wiring hack, triplicated dual APIs, two over-granular services, one over-engineered cache — is what the redesign sheds. The lockfile extraction is well-seamed once pnpm name resolution and integrity checking are made pure.
