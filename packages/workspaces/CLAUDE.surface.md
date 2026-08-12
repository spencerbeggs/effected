# Public surface — @effected/workspaces

Module map, entry points and composite layers.

**Parent:** [@effected/workspaces context](./CLAUDE.md)

## Entry points

`src/index.ts` is the only re-exporting module. The package ships a **second entry**, `@effected/workspaces/node-sync` (`src/node-sync.ts`) — the node-bound preset for the sync entry points (`nodeFileSystem`, `nodePath`, `nodeSyncOps`). It is a separate subpath deliberately: the main entry imports nothing platform-shaped, and `index.ts` must never re-export it or `node:` imports leak into every consumer.

## Module map

Read the module for its types; this is the index, not the API.

- `WorkspacePackage.ts` — `WorkspacePackage`, `PublishConfig`, `DependencyDiff`, `WorkspaceManifestError`
- `WorkspaceRoot.ts` — the `WorkspaceRoot` service + layer + double (`makeTest` / `layerTest`), `WorkspaceRootShape`, `WORKSPACE_MARKERS`, `FindWorkspaceRootOptions`, `WorkspaceRootNotFoundError`
- `PackageManagerName.ts` — `PackageManagerName`, `DetectedPackageManager`, `PackageManagerDetector` (+ double), `PackageManagerDetectorShape`, `PackageManagerDetectionError`
- `WorkspaceDiscovery.ts` — `WorkspaceDiscovery`, `WorkspaceInfo`, three errors, the `workspaceResolver` layer, and the double (empty-workspace defaults derived from the effective `listPackages`; `info` dies unless stubbed)
- `DependencyGraph.ts` — `DependencyGraph` (a **value class**, not a service), `CyclicDependencyError`
- `ChangeDetector.ts` — `ChangeDetector`, `ChangeDetectionOptions`, `ChangeDetectionError`, `ChangeDetectionFailure`
- `WorkspaceSnapshots.ts` — `WorkspaceSnapshots` (`at(ref)` / `worktree()`) and its two failure unions
- `WorkspaceStateSnapshot.ts` — `WorkspaceStateSnapshot`, `PackageStateSnapshot`
- `WorkspaceCatalogs.ts` — `CatalogSet`, `WorkspaceCatalogs` (incl. `releaseAgeGate()`, `importerVersions()`), `ImporterVersions`, the `catalogResolver` layer, `CatalogAssemblyFailure`
- `ConfigDependencyHooks.ts` — the contract, `HookInjection`, and `layerNoop` / `layerLive` / `layerSubprocess`
- `LockfileReader.ts` — `LockfileReader`, `LockfileReadError`
- `Publishability.ts` — `PublishabilityDetector`, `PublishTarget`
- `ReleaseTag.ts` — `ReleaseTag`, `TagStyle`, `TagFormatOptions`, the floating-alias family `TrackingTag` / `TrackingTagOptions`, and `classifyTag` / `TagClassification` (all **value classes**; a leaf importing nothing else here)
- `VersioningStrategy.ts` — `VersioningStrategy` (a **value class**: `classify` / `detect` / `tagsFor`), `VersioningStrategyType`, `ClassifyOptions`, `VersioningDetectOptions`, `PackageRelease`
- `Workspaces.ts` — the composites, the one-call manifest path, `localExecLayer`
- `WorkspacesSync.ts` — `findWorkspaceRootSync`, `getWorkspacePackagesSync` over consumer-supplied `SyncFileSystem` / `SyncPath` ops
- `node-sync.ts` — the node-bound ops preset (`node:fs` / `node:path`), published only under `./node-sync`

`CatalogAssemblyError` lives in `@effected/npm`, beside the contract that names it in its channel, and is deliberately **not re-exported** here. `catalogResolver` passes assembly failures through **typed** as that error; only an unfindable workspace root wraps as `DependencyResolutionError`.

## Composites

`Workspaces.ts` exposes `layer`, `layerWithConfigDependencies`, `layerWithConfigDependenciesSubprocess`, `layerWithGit`, `resolvers`, the one-call manifest path (`resolverLayer`, `resolveManifest`) and `localExecLayer`.

`Workspaces` is a static class with a private constructor, **not an `as const` namespace object** — an `as const` object's member types are inferred in the built `.d.ts` and lose their TSDoc; `static readonly` keeps it, and call syntax is unaffected.

## Ambient cwd

Root resolution is **one concern**: every root-consuming layer takes `{ cwd }`, defaulting to `process.cwd()` read lazily inside `Effect.suspend`. No service method reaches for the ambient cwd. The factories are parameterized, so bind them to a `const` — layers memoize by reference.

`Workspaces.resolverLayer(options?)` is the deliberate exception: a fresh, unmemoized layer per call **is the feature** — each call re-runs root discovery (including a per-call `process.cwd()` read), so a build tool that changes directory between manifests stays correct. It wires the pnpmfile-replay path (`layerWithConfigDependencies`); compose `Workspaces.resolvers` with `Workspaces.layer` yourself if config-dependency code must not run. `Workspaces.resolveManifest(manifest, options?)` runs `@effected/npm`'s `Manifest.resolve()` over a fresh `resolverLayer` — decode with `Manifest.decode` at the edge, and check the pure `manifest.needsResolution` first to skip catalog assembly entirely.

**Related:** [discovery](./CLAUDE.discovery.md) · [catalogs](./CLAUDE.catalogs.md) · [snapshots](./CLAUDE.snapshots.md)
