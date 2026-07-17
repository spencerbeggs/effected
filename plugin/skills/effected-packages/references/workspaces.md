# @effected/workspaces

Monorepo tooling as Effect services: workspace root discovery, package enumeration, the dependency graph, package-manager detection, pnpm/bun catalog resolution, lockfile IO, git change detection and point-in-time snapshots. Integrated tier: real runtime deps on the `@pnpm/catalogs.*` quartet (confined to one internal module) plus most of the kit's lower tiers.

## Import

```ts
import {
 ChangeDetector,
 DependencyGraph,
 PackageManagerDetector,
 PublishabilityDetector,
 WorkspaceDiscovery,
 WorkspaceRoot,
 Workspaces,
 WorkspaceSnapshots,
} from "@effected/workspaces";
```

**Not single-entrypoint**: the package ships a real second export, `@effected/workspaces/node-sync` — deliberate, so the main entry never imports `node:*`.

```ts
// Node bindings for the sync escape hatch — a separate subpath, not the main entry.
import { findWorkspaceRootSync, getWorkspacePackagesSync } from "@effected/workspaces";
import { nodeSyncOps } from "@effected/workspaces/node-sync";

const root = findWorkspaceRootSync(nodeSyncOps);
const packages = root === null ? [] : getWorkspacePackagesSync(root, nodeSyncOps);
```

The platform-agnostic sync functions (`findWorkspaceRootSync`, `getWorkspacePackagesSync`, and the `WorkspacesSyncOptions`/`SyncFileSystem`/`SyncPath` types they take) live in the MAIN entrypoint — they accept consumer-supplied file/path operations and import no platform module themselves. Only the ready-made Node bindings (`nodeFileSystem`, `nodePath`, and the combined `nodeSyncOps`) live under `./node-sync`. Reach for either only where you genuinely cannot run an Effect (a Vitest config is the motivating case); the async `WorkspaceRoot`/`WorkspaceDiscovery` services are the default.

**Platform**: you provide `FileSystem` and `Path` at the edge — `@effect/platform-node` or `@effect/platform-bun`. `Workspaces.layerWithGit` additionally needs `ChildProcessSpawner`; `NodeServices.layer` provides all three in one move.

## Core API

- **`Workspaces.layer(options?)`** / `.layerWithConfigDependencies` / `.layerWithGit` — composite layers wiring everything (the full set is `WorkspaceRoot | PackageManagerDetector | WorkspaceDiscovery | LockfileReader | WorkspaceCatalogs | PublishabilityDetector`, plus `ChangeDetector | WorkspaceSnapshots | Git` from `.layerWithGit`). **`Workspaces.resolvers`** merges the real implementations of `@effected/npm`'s `CatalogResolver` + `WorkspaceResolver` contracts — provide it wherever `Package.resolve` (from `@effected/package-json`) must turn `catalog:`/`workspace:` specifiers into real versions. **`Workspaces.resolverLayer(options?)`** is the same pair but built fresh (unmemoized) per call — the deliberate exception, so a long-lived tool that changes directory between manifests re-runs root discovery each time. **`Workspaces.resolveManifest(manifest, options?)`** is the one-call path: runs `@effected/npm`'s `Manifest.resolve()` over a fresh `resolverLayer`; check the manifest's own `needsResolution` first to skip catalog assembly entirely when nothing needs it.
- **`WorkspaceRoot`** — root discovery over `@effected/walker`; markers: `pnpm-workspace.yaml`, then `package.json` with `workspaces`. `WorkspaceRootNotFoundError`.
- **`WorkspaceDiscovery`** — `listPackages()` enumerates `WorkspacePackage`s (tolerant schema; `pkg.manifest()` bridges to the strict `@effected/package-json` `Package` on demand); also implements the `WorkspaceResolver` contract.
- **`WorkspacePackage`** — fields: `name`, `version` (raw string, NOT semver-validated), `path`, `packageJsonPath`, `relativePath`, `private`, the four dependency maps, `publishConfig?: PublishConfig`, `manifestRecord` (the as-read `package.json`, `unknown` values, for tolerant access to fields outside the typed slice). Getters: `isRootWorkspace`, `isPublic`, `scope: Option<string>`, `unscopedName`, `allDependencies` (merged, `dependencies` > `devDependencies` > `peerDependencies` > `optionalDependencies` on a name in several). Methods: `hasDependency`/`hasDevDependency`/`hasPeerDependency`/`hasOptionalDependency`/`hasAnyDependencyOn(name)`, `dependencyVersion(name): Option<string>`, `matchesDependency(pattern: GlobPattern | string)` (a raw string is compiled per call — a bad literal is a caller-wiring defect, not a typed error; compile once with `GlobPattern.compile` when testing many packages), `dependencyDiff(other)` → `DependencyDiff` (`added`/`removed`/`changed`, merged across all four kinds), `toWorkspaceManifest()` (projects to `@effected/lockfiles`' `WorkspaceManifest`), `manifest()` (re-reads and decodes the strict `Package`, `Effect<Package, WorkspaceManifestError, FileSystem>`).
- **`PublishConfig`** — the typed projection of `publishConfig` workspace tooling reads: `access?`, `registry?`, `directory?`, `linkDirectory?` (whether workspace links point into `directory` during local development — pnpm symlinks the publish directory instead of the package root; meaningful only alongside `directory`), `tag?`. Deliberately narrow — `@effected/package-json` keeps the full open record for round-trip fidelity; this is the handful of fields that decide where/whether/as-what a package publishes.
- **`PublishabilityDetector`** — `Context.Service`; `detect(pkg: WorkspacePackage) => Effect<ReadonlyArray<PublishTarget>>` — an intentionally TOTAL (`never`-erroring) question: empty means "does not publish". `PublishabilityDetector.layer` implements standard npm semantics (private + no `publishConfig.access` → publishes nowhere; explicit `access` overrides `private`; otherwise public with defaults). An overriding layer with a fallible lookup must degrade to a safe answer or `Effect.die` — it cannot widen the `never` channel. `PublishTarget` — `name`, `registry`, `directory`, `access: "public" | "restricted"`, `provenance` (defaulted).
- **`DependencyGraph`** — pure value class: `sort`, `sortSubset`, `levels` (deterministic Kahn), `hasCycle`, `dependenciesOf`/`dependentsOf`; `CyclicDependencyError`.
- **`PackageManagerDetector`** — `"npm" | "pnpm" | "yarn" | "bun"` from lockfile evidence + `packageManager`/`devEngines` fields.
- **`WorkspaceCatalogs` / `CatalogSet`** — pnpm/bun catalog assembly; `WorkspaceCatalogs.catalogResolver` implements the `CatalogResolver` contract.
- **`ChangeDetector`** — `changedFiles`/`workingChanges` over `@effected/git` (`includeUncommitted` option).
- **`WorkspaceSnapshots`** — `at(ref)` (git-only, no checkout, cached per `(root, ref)`) and `worktree()` (live tree, uncached), both returning `WorkspaceStateSnapshot` (`versions`, `package(name)`, `resolve(...)`, snapshot-scoped resolver layers).
- **`LockfileReader`** — root → PM detection → file read → `Lockfile.parse`.
- **Sync escape hatch (bare consts, NOT a `WorkspacesSync` namespace)** — `findWorkspaceRootSync(options)` / `getWorkspacePackagesSync(root, options)`, both re-exported from the MAIN entrypoint and platform-agnostic. There is no `WorkspacesSync` namespace object; each is a free-standing const taking a required options bag that carries a consumer-supplied `SyncFileSystem`/`SyncPath` — nothing defaults to Node. Pass `nodeSyncOps` from `@effected/workspaces/node-sync` (or `{ ...nodeSyncOps, cwd }`) as shown above. For config-time discovery that cannot `await` (e.g. a vitest config). Both are **total** — an unenumerable pattern or unreadable manifest is skipped, never raised, and only truncate at a depth/budget bound where the async surface fails typed.

## Usage

Diffing dependency state between two points in time — a released tag and the live working tree:

```ts
import { WorkspaceSnapshots } from "@effected/workspaces";
import { Effect } from "effect";

const program = Effect.gen(function* () {
 const snapshots = yield* WorkspaceSnapshots;
 const before = yield* snapshots.at("v1.2.0");
 const after = yield* snapshots.worktree();
 return { before: before.versions, after: after.versions };
});
```

`PublishabilityDetector` with a test double — override the shape's `never` error channel per the "degrade or die" contract, and filter a package list down to what actually publishes:

```ts
import type { WorkspacePackage } from "@effected/workspaces";
import { PublishabilityDetector, PublishTarget } from "@effected/workspaces";
import { Effect, Layer } from "effect";

const scopedOnly = Layer.succeed(PublishabilityDetector, {
 detect: (pkg) =>
  Effect.succeed(
   pkg.name.startsWith("@acme/")
    ? [PublishTarget.make({ name: pkg.name, registry: "https://registry.acme.dev/", directory: ".", access: "restricted" })]
    : [],
  ),
});

const publishableNames = (packages: ReadonlyArray<WorkspacePackage>) =>
 Effect.gen(function* () {
  const detector = yield* PublishabilityDetector;
  const names = new Set<string>();
  for (const pkg of packages) {
   const targets = yield* detector.detect(pkg);
   if (targets.length > 0) names.add(pkg.name);
  }
  return names;
 }).pipe(Effect.provide(scopedOnly));
```

Composing `Workspaces.layerWithGit` for a downstream service that needs several kit services at once — build the graph ONCE and reuse it, since layers memoize by reference:

```ts
import { WorkspaceDiscovery, Workspaces, WorkspaceSnapshots } from "@effected/workspaces";
import { NodeServices } from "@effect/platform-node";
import { Context, Effect, Layer } from "effect";

class Reporter extends Context.Service<Reporter, { readonly run: () => Effect.Effect<unknown> }>()("Reporter") {}

// Bind once — calling layerWithGit again mints an independent graph.
const KitGraph = Workspaces.layerWithGit();

const ReporterLive = Layer.effect(
 Reporter,
 Effect.gen(function* () {
  const discovery = yield* WorkspaceDiscovery;
  const snapshots = yield* WorkspaceSnapshots;
  return {
   run: () =>
    Effect.gen(function* () {
     const packages = yield* discovery.listPackages();
     const state = yield* snapshots.worktree();
     return { count: packages.length, versions: state.versions };
    }),
  };
 }),
).pipe(Layer.provide(KitGraph), Layer.provide(NodeServices.layer));
```

## Testing machinery

None exported. Unit-test consumers with core's `Path.layer` + `FileSystem.layerNoop`; mock git-backed services with `Layer.succeed(Git, ...)` and publishability with `Layer.succeed(PublishabilityDetector, ...)` — no real repo or platform package needed.

## Gotchas

- `PackageManagerName` is structurally identical to `@effected/lockfiles`' `LockfileFormat` but is a different concept — don't conflate them when importing both.
- `WorkspacePackage` is deliberately tolerant (one bad member must not fail whole-repo discovery); `pkg.manifest()` — a method call, not a property — opts into the strict decode, and genuinely re-reads the file rather than reusing `manifestRecord`.
- Layer factories taking options (`WorkspaceDiscovery.layer({ cwd })`, `WorkspaceSnapshots.layer(...)`) mint a fresh layer per call — bind to a `const`; layers memoize by reference. `Workspaces.resolverLayer` is the deliberate exception: a fresh layer per call IS the feature.
- `WorkspaceSnapshots.at(ref)` never replays config-dependency pnpmfile hooks (an at-ref read must not execute historical code) — `at()` and `worktree()` catalogs can diverge under `layerWithConfigDependencies`.
- `PublishabilityDetector`'s error channel is `never` by contract — an overriding layer backed by something fallible must fold failures into a safe answer or `Effect.die`; it cannot widen the channel the shape declares.
- `matchesDependency` compiles a raw string pattern on every call; an uncompilable literal throws as a defect (developer wiring, not untrusted input) rather than a typed error.
