---
"@effected/workspaces": minor
---

## Features

### Composites that pair the git tier with config-dependency catalog replay

`Workspaces.layerWithGitAndConfigDependencies` and `Workspaces.layerWithGitAndConfigDependenciesSubprocess` provide snapshots, change detection and `Git` over catalog assembly that replays config-dependency `pnpmfile` hooks. `Workspaces.layerWithGit` wires the no-op catalogs layer, so getting both halves previously meant rebuilding the whole service graph by hand.

On these composites the subprocess variant costs nothing extra — `ChildProcessSpawner` is already required for `Git` — so a bundled consumer, where the in-process computed `import()` cannot survive a bundler, should prefer it.

Both take the new `WorkspacesGitOptions` (`WorkspacesOptions` plus `WorkspaceSnapshotsOptions`), which is how `seedCatalogs` reaches `at(ref)` through a composite.

### Seeded catalogs on `WorkspaceStateSnapshot`

A catalog injected by a config-dependency hook is declared in no committed source, so `WorkspaceSnapshots.at(ref)` — which never replays hooks — cannot see it, and a `catalog:` specifier against it resolves to nothing on both sides of a diff.

`WorkspaceStateSnapshot.seededCatalogs` holds catalogs supplied by the caller and is consulted only where the snapshot's own catalogs cannot answer:

```ts
const live = yield* catalogs.set();
const before = (yield* snapshots.at("origin/main")).withSeededCatalogs(live);
before.resolve("hooked-dep", "catalog:"); // Option.some("^9.9.9")
```

* `withSeededCatalogs(seed)` returns a new snapshot; it replaces any existing seed rather than merging
* `WorkspaceStateSnapshot.crossSeed(before, after)` seeds each side of a two-ref diff with the other's catalogs
* `WorkspaceSnapshotsOptions.seedCatalogs` is the layer-level form, applied to `at(ref)` and `worktree()` alike

Resolution order in `resolve`, `resolveIn` and the snapshot-scoped `catalogResolver` is the snapshot's own catalogs, then the seed, then the existing `importerVersions` fallback. The first two answer with a declared range and the third with a concrete version, so a seeded snapshot reports a range change where an unseeded one can only report a version.

`catalogs` is unchanged and still means the set assembled at that moment; the seed is a separate field so a stored snapshot keeps the two distinguishable.

### Per-call-root discovery

`WorkspaceDiscovery.listPackagesIn(directory)` and `infoIn(directory)` discover the workspace containing `directory` rather than the root the layer was bound to — for a long-lived host that resolves one root at startup and then serves calls scoped to a git worktree, a nested repository, or another project.

They re-read: patterns, member manifests, names and versions all come from beneath the named root, so a worktree branch that adds, removes or renames a package is visible. `directory` may be the root or anything inside it, and results memoize per resolved root.

## Breaking Changes

`WorkspaceDiscovery.makeTest` and `layerTest` die with an instructive defect when `listPackagesIn` or `infoIn` is called without an override. Deriving them from `listPackages` would model every root as holding the same members, which is the confusion these methods exist to remove.

A double that never calls them is unaffected. A test that does needs an explicit override:

```ts
const double = WorkspaceDiscovery.layerTest({
  listPackagesIn: () => Effect.succeed([]),
});
```

`WorkspaceDiscovery.refresh()` now also drops the per-root memos, not only the layer-bound one.
