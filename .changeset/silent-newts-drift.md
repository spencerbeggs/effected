---
"@effected/workspaces": minor
---

## Breaking Changes

### `GitReader` is retired

`ChangeDetector` now runs entirely on `@effected/git`'s `Git` service instead of the v1 `GitReader` subprocess seam. `GitReader` and its `GitCommandError` are no longer exported from `@effected/workspaces`; a non-repository now surfaces as `@effected/git`'s typed `NotARepositoryError` instead.

```ts
// Before
import { GitReader } from "@effected/workspaces";
const Layer = Workspaces.layerWithGit(); // wired GitReader.layerNode internally

// After — provide ChildProcessSpawner at the edge instead of GitReader.layerNode
import { NodeServices } from "@effect/platform-node";
import { Workspaces } from "@effected/workspaces";
import { Layer } from "effect";

const Layer2 = Workspaces.layerWithGit().pipe(Layer.provide(NodeServices.layer));
```

A caller catching workspaces' own `GitCommandError` should catch `@effected/git`'s `GitCommandError`/`NotARepositoryError`/`UnknownRefError` instead — re-exported alongside `ChangeDetector`'s failure union.

## Features

### Point-in-time workspace state: `WorkspaceSnapshots`

A new `WorkspaceSnapshots` service reads workspace state at a git ref with no checkout (`at(ref)`), or the live worktree (`worktree()`), into a serializable `WorkspaceStateSnapshot` value. A snapshot resolves `workspace:` and `catalog:` specifiers against its own captured state, and hands back `@effected/npm` resolver layers scoped to itself.

```ts
import { WorkspaceSnapshots } from "@effected/workspaces";
import { Effect } from "effect";

const program = Effect.gen(function* () {
	const snapshots = yield* WorkspaceSnapshots;
	const before = yield* snapshots.at("origin/main");
	const after = yield* snapshots.worktree();
	return { before: before.versions, after: after.versions };
});
```

`Workspaces.layerWithGit()` now also provides `WorkspaceSnapshots` alongside `ChangeDetector`, both over `@effected/git`'s `Git` service.

### Package-manager-aware catalog reads

Catalog assembly now reads bun's inline catalogs from a root `package.json`'s `workspaces.catalog` / `workspaces.catalogs`, and reads a worktree lockfile's recorded catalogs regardless of its extension (pnpm's `pnpm-lock.yaml` and bun's `bun.lock` are both recognized) instead of assuming the pnpm shape.

### Opt-in config-dependency hook replay

A new `ConfigDependencyHooks` service replays a `configDependencies` entry's `pnpmfile.cjs` `updateConfig` hook in process, over the inline-catalog seed, so a hook-injected catalog participates in assembly. It is off by default — `Workspaces.layer()` and `Workspaces.layerWithGit()` wire the no-op implementation and execute no config-dependency code. Opt in with `Workspaces.layerWithConfigDependencies()`.

```ts
import { Workspaces } from "@effected/workspaces";

const WorkspacesLayer = Workspaces.layerWithConfigDependencies();
```
