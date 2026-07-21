# @effected/workspaces

## 0.5.2

### Bug Fixes

* ### Internal @effected edges float patches instead of pinning exact versions

  The kit's internal `@effected/*` dependency edges were declared as `workspace:*`, which the publish transform projects to an exact version pin. That coupled every kit release — a single sibling patch forced a coordinated re-release of every dependent, just to move the pin — and two paths pinning adjacent exact versions could not dedupe in a consumer's tree.

  Every internal `@effected/*` edge, both peer and regular dependency, is now declared `workspace:~`, which projects to a patch-floating `~0.x.y` range. A sibling patch flows into existing releases without a re-release, while a minor bump — the kit's breaking channel on the `0.x` line — still requires the intended coordinated release because `~` holds the minor. Floating the regular-dependency edges as well lets a consumer's paths dedupe onto one sibling copy, which matters where an integrated package surfaces a sibling's types across its API. The `effect` peer, the catalog specifiers, and the `devDependencies` mirrors are unchanged. [#134][#134]

### Dependencies

| Dependency             | Type       | Action  | From  | To    |
| ---------------------- | ---------- | ------- | ----- | ----- |
| @effected/lockfiles    | dependency | updated | 0.1.7 | 0.1.8 |
| @effected/npm          | dependency | updated | 0.2.2 | 0.2.3 |
| @effected/package-json | dependency | updated | 0.4.0 | 0.4.1 |
| @effected/walker       | dependency | updated | 0.3.0 | 0.3.1 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#134]: https://github.com/spencerbeggs/effected/pull/134

## 0.5.1

### Dependencies

| Dependency          | Type       | Action  | From  | To    |
| ------------------- | ---------- | ------- | ----- | ----- |
| @effected/lockfiles | dependency | updated | 0.1.6 | 0.1.7 |

## 0.5.0

### Breaking Changes

* ### `WorkspacePackage.workspaceRoot` is now a required field

  `WorkspacePackage` gains `workspaceRoot: Schema.NonEmptyString`, populated by both minting sites (`WorkspaceDiscovery`'s enumerator and `WorkspacesSync`'s sync entry point). Every construction site of `WorkspacePackage` breaks.

  Because `WorkspacePackage` is a `Schema.Class`, code that still builds the old shape does not fail to type-check — it fails to **decode, at runtime**. A `WorkspacePackage` value serialized before this change (persisted to disk, sent over a wire, cached) will fail to decode against the new schema.

  The motivation is that discovery already resolves the root before enumerating, and the sync entry point is handed it, so leaving it off `WorkspacePackage` was pure information loss: consumers were reconstructing the root themselves by counting `relativePath` segments and re-ascending that many `..`, which only stays correct while `path` and `relativePath` agree.

  **Migration:** pass `workspaceRoot` alongside the package's other fields at every hand-built `WorkspacePackage.make(...)` call site. For values obtained through `WorkspaceDiscovery` or `getWorkspacePackagesSync`, no change is needed — both minting sites already populate the field. Any previously serialized `WorkspacePackage` value must be re-derived by re-running discovery; there is no honest default root to substitute, so decoding fails loudly rather than resolving config against a silently wrong path.

### Features

* ### Bounded upward ascent: `stopAt` and `maxDepth` on `WorkspaceRoot.find`

  `WorkspaceRoot.find` accepts a new `FindWorkspaceRootOptions` second argument, `{ stopAt?: string; maxDepth?: number }`, passed straight through to `@effected/walker`'s `Walker.ascend`. `stopAt` is inclusive — the ceiling directory is itself probed — and is resolved to an absolute path before comparison. An unmarked ceiling now fails typed with `stopAt` recorded on the new optional field on `WorkspaceRootNotFoundError`, distinguishing "no workspace root anywhere above me" from "none below the ceiling I set".

  ### `WorkspaceRoot.makeTest` / `WorkspaceRoot.layerTest` — a sanctioned test double

  ```ts
  import { WorkspaceRoot } from "@effected/workspaces";

  const TestRoot = WorkspaceRoot.layerTest("/repo");
  ```

  Consumers were hand-writing the same four-line `Layer.succeed(WorkspaceRoot, { find: () => Effect.succeed("/repo") })` mock across nine call sites, plus three whole-module `vi.mock`s. `layerTest` honors `stopAt`: a hand-rolled `find` that ignores the ceiling would make a bounded call pass under test and fail live, which is exactly the failure `stopAt` exists to catch. The service contract is also now exported as `WorkspaceRootShape`, so a consumer can type a bespoke double against it instead of re-deriving the shape. [#125][#125]

### Dependencies

| Dependency             | Type       | Action  | From  | To    |
| ---------------------- | ---------- | ------- | ----- | ----- |
| @effected/glob         | dependency | updated | 0.1.2 | 0.2.0 |
| @effected/lockfiles    | dependency | updated | 0.1.5 | 0.1.6 |
| @effected/npm          | dependency | updated | 0.2.1 | 0.2.2 |
| @effected/package-json | dependency | updated | 0.3.1 | 0.4.0 |
| @effected/semver       | dependency | updated | 0.1.1 | 0.2.0 |
| @effected/walker       | dependency | updated | 0.2.2 | 0.3.0 |
| @effected/yaml         | dependency | updated | 0.4.0 | 0.5.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#125]: https://github.com/spencerbeggs/effected/pull/125

## 0.4.1

### Dependencies

| Dependency             | Type       | Action  | From  | To    |
| ---------------------- | ---------- | ------- | ----- | ----- |
| @effected/git          | dependency | updated | 0.4.0 | 0.4.1 |
| @effected/glob         | dependency | updated | 0.1.1 | 0.1.2 |
| @effected/lockfiles    | dependency | updated | 0.1.4 | 0.1.5 |
| @effected/npm          | dependency | updated | 0.2.0 | 0.2.1 |
| @effected/package-json | dependency | updated | 0.3.0 | 0.3.1 |
| @effected/semver       | dependency | updated | 0.1.0 | 0.1.1 |
| @effected/walker       | dependency | updated | 0.2.1 | 0.2.2 |
| @effected/yaml         | dependency | updated | 0.3.1 | 0.4.0 |

* | Dependency | Type           | Action  | From          | To            |                                                                       |
  | ---------- | -------------- | ------- | ------------- | ------------- | --------------------------------------------------------------------- |
  | effect     | peerDependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 | [#122][#122] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#122]: https://github.com/spencerbeggs/effected/pull/122

## 0.4.0

### Breaking Changes

* ### `findWorkspaceRootSync` takes `cwd` positionally

  `findWorkspaceRootSync` changed from a single options bag carrying an
  optional `cwd` to a path-first signature, matching the rest of the kit's
  sync facades:

  ```ts
  // Before
  const root = findWorkspaceRootSync({ ...nodeSyncOps, cwd: process.cwd() });

  // After
  const root = findWorkspaceRootSync(process.cwd(), nodeSyncOps);
  ```

  `cwd` is now required — the function no longer reads `process.cwd()`
  ambiently when it is omitted — and the `FindWorkspaceRootSyncOptions` type
  has been removed; pass `WorkspacesSyncOptions` directly. This is a
  pre-`0.1.0` change; nothing built on the old signature has been published.

### Features

* ### `WorkspaceDiscovery.makeTest` / `layerTest` test doubles

  Added an in-memory test double of `WorkspaceDiscovery`, with every method
  defaulted so a test stubs only what it exercises. Defaults model an empty
  workspace; `getPackage`, `importerMap`, and `resolveFile`/`resolveFiles` are
  all derived from the effective `listPackages` (the override when one is
  supplied), so stubbing just `listPackages` yields a consistent double.
  `getPackage` fails with the service's own typed `PackageNotFoundError` on a
  miss, exactly as the live implementation does; an unstubbed `info()` call
  dies with an explanatory defect rather than fabricating a root path.

  ```ts
  import { WorkspaceDiscovery, WorkspacePackage } from "@effected/workspaces";
  import { Effect } from "effect";

  const TestDiscovery = WorkspaceDiscovery.layerTest({
  	listPackages: () =>
  		Effect.succeed([
  			WorkspacePackage.make({
  				name: "@my-org/utils",
  				version: "1.0.0",
  				path: "/repo/packages/utils",
  				packageJsonPath: "/repo/packages/utils/package.json",
  				relativePath: "packages/utils",
  			}),
  		]),
  });
  // program.pipe(Effect.provide(TestDiscovery))
  ```

  Bind the result of `layerTest(...)` to a `const` and reuse it — each call
  mints a fresh reference, and layers memoize by reference. [#112][#112]

### Dependencies

| Dependency          | Type       | Action  | From  | To    |
| ------------------- | ---------- | ------- | ----- | ----- |
| @effected/lockfiles | dependency | updated | 0.1.3 | 0.1.4 |
| @effected/yaml      | dependency | updated | 0.3.0 | 0.3.1 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#112]: https://github.com/spencerbeggs/effected/pull/112

## 0.3.1

### Dependencies

| Dependency          | Type       | Action  | From  | To    |
| ------------------- | ---------- | ------- | ----- | ----- |
| @effected/git       | dependency | updated | 0.3.0 | 0.4.0 |
| @effected/glob      | dependency | updated | 0.1.0 | 0.1.1 |
| @effected/lockfiles | dependency | updated | 0.1.2 | 0.1.3 |
| @effected/walker    | dependency | updated | 0.2.0 | 0.2.1 |
| @effected/yaml      | dependency | updated | 0.2.0 | 0.3.0 |

* | Dependency       | Type       | Action | From | To    |                                                                       |
  | ---------------- | ---------- | ------ | ---- | ----- | --------------------------------------------------------------------- |
  | @effected/semver | dependency | added  | —    | 0.1.0 | [#106][#106] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#106]: https://github.com/spencerbeggs/effected/pull/106

## 0.3.0

### Features

* ### `@effected/workspaces/node-sync` — Node-bound sync entry preset

  A new subpath entry ships ready-made `SyncFileSystem` and `SyncPath` operations over `node:fs` / `node:path`, so adopting `findWorkspaceRootSync` / `getWorkspacePackagesSync` is one import instead of four hand-wired one-liners:

  ```ts
  import { findWorkspaceRootSync, getWorkspacePackagesSync } from "@effected/workspaces";
  import { nodeSyncOps } from "@effected/workspaces/node-sync";

  const root = findWorkspaceRootSync(nodeSyncOps);
  const packages = root === null ? [] : getWorkspacePackagesSync(root, nodeSyncOps);
  ```

  It's a separate subpath deliberately: the main entry imports nothing platform-shaped, so consumers supplying their own operations (a win32-explicit `path`, a Bun or Deno binding, a test fake) never pull in `node:*` imports.

  ### Typed `PublishabilityDetectorShape`

  The `PublishabilityDetector` service's interface is now exported as `PublishabilityDetectorShape`, for typing a variable, field, or an overriding layer without re-declaring the surface. Its `detect` method's error channel is deliberately `never` — an override backed by something fallible must degrade to a safe answer or die, never silently swallow a failure into a wrong "publishes to npm" answer.

  ### `PublishConfig.linkDirectory`

  `PublishConfig` gains an optional `linkDirectory: boolean` field, meaningful alongside `directory`: it signals whether workspace links should point into the publish subdirectory during local development, so siblings resolve the built artifact they'd install from the registry rather than the package root. [#91][#91]

### Dependencies

| Dependency             | Type       | Action  | From  | To    |
| ---------------------- | ---------- | ------- | ----- | ----- |
| @effected/git          | dependency | updated | 0.2.0 | 0.3.0 |
| @effected/lockfiles    | dependency | updated | 0.1.1 | 0.1.2 |
| @effected/package-json | dependency | updated | 0.2.0 | 0.3.0 |
| @effected/walker       | dependency | updated | 0.1.0 | 0.2.0 |
| @effected/yaml         | dependency | updated | 0.1.0 | 0.2.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#91]: https://github.com/spencerbeggs/effected/pull/91

## 0.2.1

### Dependencies

| Dependency    | Type       | Action  | From  | To    |
| ------------- | ---------- | ------- | ----- | ----- |
| @effected/git | dependency | updated | 0.1.0 | 0.2.0 |

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
