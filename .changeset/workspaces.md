---
"@effected/workspaces": minor
---

## Features

Initial release: monorepo workspace tooling as Effect services — find the workspace root, enumerate its packages, walk the dependency graph, detect the package manager, resolve pnpm catalogs, read the lockfile, and work out which packages a git range touches. Works with npm, pnpm, yarn Berry and bun; every capability is a service you provide at the edge and swap in tests.

### Discovery and the dependency graph

`WorkspaceDiscovery` enumerates packages with a bounded descent that honours segment-crossing `packages/**` patterns. `DependencyGraph` is a value class over discovered packages — `levels()` gives parallel build tiers and fails with `CyclicDependencyError` when there is no ordering.

```ts
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { DependencyGraph, WorkspaceDiscovery, Workspaces } from "@effected/workspaces";
import { Effect, Layer } from "effect";

const Platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
const WorkspacesLayer = Workspaces.layer().pipe(Layer.provide(Platform));

const program = Effect.gen(function* () {
  const discovery = yield* WorkspaceDiscovery;
  const packages = yield* discovery.listPackages();
  const graph = DependencyGraph.make({ packages });
  return yield* graph.levels();
});

Effect.runPromise(program.pipe(Effect.provide(WorkspacesLayer))).then(console.log);
```

### Change detection

`ChangeDetector` offers three depths on one service — `changedFiles`, `changedPackages` and `affectedPackages` (the transitive blast radius). Git is a separate layer (`Workspaces.layerWithGit`) rather than a flag, so a consumer that never detects changes never needs to spawn a subprocess.

```ts
import { ChangeDetectionOptions, ChangeDetector, Workspaces } from "@effected/workspaces";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const detector = yield* ChangeDetector;
  const affected = yield* detector.affectedPackages(ChangeDetectionOptions.make({ base: "origin/main" }));
  return affected.map((pkg) => pkg.name);
});
```

### Catalogs, detection and the sync escape hatch

`WorkspaceCatalogs` assembles pnpm catalogs with pnpm's precedence and supplies the real `CatalogResolver` / `WorkspaceResolver` implementations for `@effected/npm` via `Workspaces.resolvers`. `PackageManagerDetector`, `LockfileReader` and `PublishabilityDetector` round out the services, and `findWorkspaceRootSync` / `getWorkspacePackagesSync` are a Node-only synchronous escape hatch for config-time callers that cannot await.
