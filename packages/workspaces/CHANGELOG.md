# @effected/workspaces

## 0.2.0

### Breaking Changes

* ### `CatalogAssemblyError` moved to `@effected/npm`

  `CatalogAssemblyError` is no longer exported from `@effected/workspaces`. Import it from `@effected/npm` instead, alongside the `CatalogResolver` contract that names it in its error channel:

  ```ts
  // before
  import { CatalogAssemblyError } from "@effected/workspaces";

  // after
  import { CatalogAssemblyError } from "@effected/npm";
  ```

  `WorkspaceCatalogs.catalogResolver` now passes a failed catalog assembly through **typed** as `CatalogAssemblyError`, rather than folding it into a `DependencyResolutionError` defect `cause`. Code that previously `_tag`-sniffed the defect to tell an assembly failure from a resolution failure should catch `CatalogAssemblyError` directly instead.

  ### `WorkspacesSync` retrofitted to consumer-supplied operations

  `findWorkspaceRootSync` and `getWorkspacePackagesSync` no longer import `node:fs` / `node:path` internally. Each now takes a single options object carrying `fileSystem` and `path` operations the caller supplies — Node's built-ins satisfy them with one-liners:

  ```ts
  import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
  import * as path from "node:path";
  import { findWorkspaceRootSync, getWorkspacePackagesSync } from "@effected/workspaces";

  const ops = {
  	fileSystem: {
  		exists: existsSync,
  		readFile: (p: string) => readFileSync(p, "utf8"),
  		readDirectory: (p: string) => readdirSync(p),
  		isDirectory: (p: string) => statSync(p).isDirectory(),
  	},
  	path, // node:path IS a SyncPath
  };

  const root = findWorkspaceRootSync(ops);
  const packages = root === null ? [] : getWorkspacePackagesSync(root, ops);
  ```

  `findWorkspaceRootSync`'s optional `cwd` now rides on the options bag rather than a positional argument. This lets the sync entry points run in any host without assuming Node or posix — pass a win32-appropriate `path` (`node:path` on Windows, or `node:path/win32` explicitly) for Windows correctness.

### Features

* ### One-call resolver factory and manifest resolution

  `Workspaces.resolverLayer(options?)` wires both `@effected/npm` contracts (`CatalogResolver`, `WorkspaceResolver`) over a real workspace from just a platform (`FileSystem` + `Path`). `Workspaces.resolveManifest(manifest, options?)` runs `@effected/npm`'s `Manifest#resolve()` over a fresh `resolverLayer` in one call:

  ```ts
  import { Manifest } from "@effected/npm";
  import { Workspaces } from "@effected/workspaces";
  import { Effect } from "effect";

  const program = Effect.gen(function* () {
  	const manifest = yield* Manifest.decode({ dependencies: { effect: "catalog:" } });
  	const resolved = manifest.needsResolution ? yield* Workspaces.resolveManifest(manifest) : manifest;
  	return resolved.toRecord();
  });
  ```

  Each call mints a fresh, unmemoized layer — root discovery (including `process.cwd()`) re-runs every time, which matters for a build tool that changes directory between manifests.

  ### `WorkspacePackage.manifestRecord`

  `WorkspacePackage` gains `manifestRecord`: the package's `package.json` as read, values `unknown`, for tolerant access to fields outside the typed discovery slice (`scripts`, `exports`, …) without a second file read. Defaults to `{}` for construction sites and previously-serialized values that predate the field. [#83][#83]

### Dependencies

| Dependency             | Type       | Action  | From  | To    |
| ---------------------- | ---------- | ------- | ----- | ----- |
| @effected/lockfiles    | dependency | updated | 0.1.0 | 0.1.1 |
| @effected/npm          | dependency | updated | 0.1.0 | 0.2.0 |
| @effected/package-json | dependency | updated | 0.1.0 | 0.2.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#83]: https://github.com/spencerbeggs/effected/pull/83

## 0.1.0

### Features

* Initial release: monorepo workspace tooling as Effect services — find the workspace root, enumerate its packages, walk the dependency graph, detect the package manager, resolve pnpm catalogs, read the lockfile, and work out which packages a git range touches. Works with npm, pnpm, yarn Berry and bun; every capability is a service you provide at the edge and swap in tests.

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

  `WorkspaceCatalogs` assembles pnpm catalogs with pnpm's precedence and supplies the real `CatalogResolver` / `WorkspaceResolver` implementations for `@effected/npm` via `Workspaces.resolvers`. `PackageManagerDetector`, `LockfileReader` and `PublishabilityDetector` round out the services, and `findWorkspaceRootSync` / `getWorkspacePackagesSync` are a Node-only synchronous escape hatch for config-time callers that cannot await. [#81][#81]

### Dependencies

| Dependency             | Type       | Action  | From  | To    |
| ---------------------- | ---------- | ------- | ----- | ----- |
| @effected/git          | dependency | updated | 0.0.0 | 0.1.0 |
| @effected/glob         | dependency | updated | 0.0.0 | 0.1.0 |
| @effected/lockfiles    | dependency | updated | 0.0.0 | 0.1.0 |
| @effected/npm          | dependency | updated | 0.0.0 | 0.1.0 |
| @effected/package-json | dependency | updated | 0.0.0 | 0.1.0 |
| @effected/walker       | dependency | updated | 0.0.0 | 0.1.0 |
| @effected/yaml         | dependency | updated | 0.0.0 | 0.1.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#81]: https://github.com/spencerbeggs/effected/pull/81
