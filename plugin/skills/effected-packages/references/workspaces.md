# @effected/workspaces

Monorepo tooling as Effect services: workspace root discovery, package enumeration, the dependency graph, package-manager detection, pnpm/bun catalog resolution, lockfile IO, git change detection and point-in-time snapshots. Integrated tier: real runtime deps on the `@pnpm/catalogs.*` quartet (confined to one internal module) plus most of the kit's lower tiers.

## Import

```ts
import {
 ChangeDetector,
 DependencyGraph,
 PackageManagerDetector,
 WorkspaceDiscovery,
 WorkspaceRoot,
 Workspaces,
 WorkspaceSnapshots,
} from "@effected/workspaces";
```

Single entrypoint (the sync escape hatch `WorkspacesSync` ships from the same entry).

**Platform**: you provide `FileSystem` and `Path` at the edge — `@effect/platform-node` or `@effect/platform-bun`. `Workspaces.layerWithGit` additionally needs `ChildProcessSpawner`; `NodeServices.layer` provides all three in one move.

## Core API

- **`Workspaces.layer(options?)`** / `.layerWithConfigDependencies` / `.layerWithGit` — composite layers wiring everything. **`Workspaces.resolvers`** merges the real implementations of `@effected/npm`'s `CatalogResolver` + `WorkspaceResolver` contracts — provide it wherever `Package.resolve` (from `@effected/package-json`) must turn `catalog:`/`workspace:` specifiers into real versions.
- **`WorkspaceRoot`** — root discovery over `@effected/walker`; markers: `pnpm-workspace.yaml`, then `package.json` with `workspaces`. `WorkspaceRootNotFoundError`.
- **`WorkspaceDiscovery`** — `listPackages()` enumerates `WorkspacePackage`s (tolerant schema; `pkg.manifest()` bridges to the strict `@effected/package-json` `Package` on demand); also implements the `WorkspaceResolver` contract.
- **`DependencyGraph`** — pure value class: `sort`, `sortSubset`, `levels` (deterministic Kahn), `hasCycle`, `dependenciesOf`/`dependentsOf`; `CyclicDependencyError`.
- **`PackageManagerDetector`** — `"npm" | "pnpm" | "yarn" | "bun"` from lockfile evidence + `packageManager`/`devEngines` fields.
- **`WorkspaceCatalogs` / `CatalogSet`** — pnpm/bun catalog assembly; `WorkspaceCatalogs.catalogResolver` implements the `CatalogResolver` contract.
- **`ChangeDetector`** — `changedFiles`/`workingChanges` over `@effected/git` (`includeUncommitted` option).
- **`WorkspaceSnapshots`** — `at(ref)` (git-only, no checkout) and `worktree()`, returning `WorkspaceStateSnapshot` (`versions`, `package(name)`, `resolve(...)`, snapshot-scoped resolver layers).
- **`LockfileReader`** — root → PM detection → file read → `Lockfile.parse`.
- **`WorkspacesSync`** — `findWorkspaceRootSync()` / `getWorkspacePackagesSync(root)`: Node-only synchronous escape hatch for config-time discovery that cannot `await` (e.g. a vitest config).

## Usage

```ts
import { WorkspaceDiscovery, Workspaces } from "@effected/workspaces";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, Layer } from "effect";

// Bind to a const: layers memoize by reference.
const Platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
const WorkspacesLive = Workspaces.layer().pipe(Layer.provide(Platform));

const names = Effect.gen(function* () {
 const discovery = yield* WorkspaceDiscovery;
 return (yield* discovery.listPackages()).map((pkg) => pkg.name);
}).pipe(Effect.provide(WorkspacesLive));
```

## Testing machinery

None exported. Unit-test consumers with core's `Path.layer` + `FileSystem.layerNoop`; mock git-backed services with `Layer.succeed(Git, ...)` — no real repo or platform package needed.

## Gotchas

- `PackageManagerName` is structurally identical to `@effected/lockfiles`' `LockfileFormat` but is a different concept — don't conflate them when importing both.
- `WorkspacePackage` is deliberately tolerant (one bad member must not fail whole-repo discovery); `pkg.manifest()` — a method call, not a property — opts into the strict decode.
- Layer factories taking options (`WorkspaceDiscovery.layer({ cwd })`) mint a fresh layer per call — bind to a `const`; layers memoize by reference.
- `WorkspaceSnapshots.at(ref)` never replays config-dependency pnpmfile hooks (an at-ref read must not execute historical code) — `at()` and `worktree()` catalogs can diverge under `layerWithConfigDependencies`.
