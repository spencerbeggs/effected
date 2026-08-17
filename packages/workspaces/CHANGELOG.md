# @effected/workspaces

## 0.14.2

### Dependencies

| Dependency             | Type       | Action  | From   | To     |
| ---------------------- | ---------- | ------- | ------ | ------ |
| @effected/lockfiles    | dependency | updated | 0.5.0  | 0.5.1  |
| @effected/npm          | dependency | updated | 0.10.0 | 0.11.0 |
| @effected/package-json | dependency | updated | 0.10.1 | 0.10.2 |

## 0.14.1

### Dependencies

| Dependency             | Type       | Action  | From   | To     |
| ---------------------- | ---------- | ------- | ------ | ------ |
| @effected/package-json | dependency | updated | 0.10.0 | 0.10.1 |

* | Dependency            | Type       | Action  | From      | To        |                                                                       |
  | --------------------- | ---------- | ------- | --------- | --------- | --------------------------------------------------------------------- |
  | @pnpm/catalogs.config | dependency | updated | ^1100.0.0 | ^1100.0.5 | [#400][#400] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#400]: https://github.com/spencerbeggs/effected/pull/400

## 0.14.0

### Dependencies

| Dependency             | Type       | Action  | From  | To     |
| ---------------------- | ---------- | ------- | ----- | ------ |
| @effected/commands     | dependency | updated | 0.4.0 | 0.5.0  |
| @effected/git          | dependency | updated | 0.8.0 | 0.9.0  |
| @effected/glob         | dependency | updated | 0.3.0 | 0.4.0  |
| @effected/lockfiles    | dependency | updated | 0.4.2 | 0.5.0  |
| @effected/npm          | dependency | updated | 0.9.0 | 0.10.0 |
| @effected/package-json | dependency | updated | 0.9.0 | 0.10.0 |
| @effected/semver       | dependency | updated | 0.4.0 | 0.5.0  |
| @effected/walker       | dependency | updated | 0.4.0 | 0.5.0  |
| @effected/yaml         | dependency | updated | 0.9.0 | 0.10.0 |

* | Dependency | Type           | Action  | From           | To           |                                                                       |
  | :--------- | :------------- | :------ | :------------- | :----------- | --------------------------------------------------------------------- |
  | effect     | peerDependency | updated | 4.0.0-beta.107 | 4.0.0-rc.109 | [#389][#389] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#389]: https://github.com/spencerbeggs/effected/pull/389

## 0.13.1

### Dependencies

| Dependency          | Type       | Action  | From  | To    |
| ------------------- | ---------- | ------- | ----- | ----- |
| @effected/lockfiles | dependency | updated | 0.4.1 | 0.4.2 |
| @effected/yaml      | dependency | updated | 0.8.0 | 0.9.0 |

## 0.13.0

### Breaking Changes

* `DetectedPackageManager` gains a required `evidence` field — the `PackageManagerEvidence` literal naming which detection rung decided the manager (`"pnpm-workspace.yaml"`, `"package.json#packageManager"`, etc.), mirroring the vocabulary `PackageManagerDetectionError.checked` already reported on the failure path. A hand-constructed `DetectedPackageManager` (a test double, a fixture) must now supply it:

  ```ts
  import { DetectedPackageManager } from "@effected/workspaces";
  import { Option } from "effect";

  DetectedPackageManager.make({
  	name: "pnpm",
  	version: Option.none(),
  	runtime: "node",
  	evidence: "pnpm-workspace.yaml",
  });
  ```

### Bug Fixes

* `ConfigDependencyHooks`' dynamic import of the pnpm plugin now carries an inline `webpackIgnore` comment, so a webpack-family bundler no longer emits an unsilenceable Critical-dependency warning for a consumer that composes `layerSubprocess` — the target module stays droppable by tree-shaking regardless. [#366][#366]

### Dependencies

| Dependency             | Type       | Action  | From  | To    |
| ---------------------- | ---------- | ------- | ----- | ----- |
| @effected/git          | dependency | updated | 0.7.0 | 0.8.0 |
| @effected/package-json | dependency | updated | 0.8.0 | 0.9.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#366]: https://github.com/spencerbeggs/effected/pull/366

## 0.12.0

### Features

* ### `DependencyGraph.toMermaid()`

  Renders a `DependencyGraph` as a Mermaid `flowchart TD` — drop it into a job summary, an issue, or a design doc. It's total (never fails), and both nodes and edges are emitted in sorted order, so the output is deterministic regardless of manifest key order. Scoped package names (`@acme/app`) appear only inside quoted labels, so they never break Mermaid syntax.

  ```ts
  console.log(graph.toMermaid());
  // flowchart TD
  //   0["@acme/app"]
  //   1["@acme/utils"]
  //   0 --> 1
  ```

### Bug Fixes

* `CyclicDependencyError.cycle` now names the packages actually in the cycle — the strongly-connected components — instead of every package Kahn's algorithm had left unprocessed when it stalled, which also included packages merely downstream of the cycle. Applies to both `levels()`/`sort()` and `sortSubset()`. The field's shape (`ReadonlyArray<string>`) is unchanged; only which packages appear in it is corrected. [#361][#361]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#361]: https://github.com/spencerbeggs/effected/pull/361

## 0.11.2

### Dependencies

| Dependency          | Type       | Action  | From  | To    |
| ------------------- | ---------- | ------- | ----- | ----- |
| @effected/lockfiles | dependency | updated | 0.4.0 | 0.4.1 |
| @effected/yaml      | dependency | updated | 0.7.0 | 0.8.0 |

## 0.11.1

### Bug Fixes

* Added the missing `@effected/semver` dependency. `@effected/lockfiles@0.4.0` added `@effected/semver` to its non-optional peerDependencies, but the 0.11.0 release did not add it to this package's own dependencies (it added `@effected/npm` and `@effected/yaml` but missed this one), so the peer bubbled up unmet to every consumer and `pnpm peers check` failed downstream. [#329][#329]

### Dependencies

* | Dependency       | Type       | Action | From | To          |
  | :--------------- | :--------- | :----- | :--- | :---------- |
  | @effected/semver | dependency | added  | —    | workspace:^ |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#329]: https://github.com/spencerbeggs/effected/pull/329

## 0.11.0

### Refactoring

* Migrated error classes to Effect's renamed `Schema.TaggedError` (was `Schema.TaggedErrorClass`); the call shape is unchanged and no consumer action is required. [#322][#322]

### Dependencies

| Dependency             | Type       | Action  | From  | To    |
| ---------------------- | ---------- | ------- | ----- | ----- |
| @effected/commands     | dependency | updated | 0.3.1 | 0.4.0 |
| @effected/git          | dependency | updated | 0.6.0 | 0.7.0 |
| @effected/glob         | dependency | updated | 0.2.2 | 0.3.0 |
| @effected/lockfiles    | dependency | updated | 0.3.2 | 0.4.0 |
| @effected/npm          | dependency | updated | 0.8.3 | 0.9.0 |
| @effected/package-json | dependency | updated | 0.7.3 | 0.8.0 |
| @effected/walker       | dependency | updated | 0.3.4 | 0.4.0 |
| @effected/yaml         | dependency | updated | 0.6.1 | 0.7.0 |

* | Dependency | Type           | Action  | From           | To             |
  | :--------- | :------------- | :------ | :------------- | :------------- |
  | effect     | peerDependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#322]: https://github.com/spencerbeggs/effected/pull/322

## 0.10.2

### Bug Fixes

* Removed the unused `@effected/semver` dependency from the published manifest. Nothing in the package imports it — the tracking-tag grammar deliberately parses version segments itself, as its own documentation states — so consumers no longer install `@effected/semver` through this package. [#299][#299]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#299]: https://github.com/spencerbeggs/effected/pull/299

## 0.10.1

### Dependencies

| Dependency    | Type       | Action  | From  | To    |
| ------------- | ---------- | ------- | ----- | ----- |
| @effected/git | dependency | updated | 0.5.2 | 0.6.0 |

## 0.10.0

### Features

* Added `ConfigDependencyHooks.layerSubprocess`, a drop-in alternative to `layerLive` that replays `configDependencies` `updateConfig` pnpmfile hooks in a `node` child process instead of an in-process dynamic `import()`.

  `layerLive` computes its `import()` path at runtime, and bundlers that compile a computed dynamic import into a context module (rspack, notably) can't resolve it at runtime — so in a bundled consumer such as a GitHub Action, the in-process replay is unreachable. `layerSubprocess` keeps every computed load out of the bundle graph by running the replay in a child process, with typed semantics identical to `layerLive`: the same hook-locator shapes, the same tolerant threading of a hook's returned config, and the same fail-open/fail-typed split between a legitimate missing pnpmfile and a real load or replay failure.

  ```ts
  import { ConfigDependencyHooks } from "@effected/workspaces";
  import { NodeServices } from "@effect/platform-node";

  const program = Effect.gen(function* () {
  	const hooks = yield* ConfigDependencyHooks;
  	return yield* hooks.inject(root, configDependencies, seed);
  }).pipe(Effect.provide(ConfigDependencyHooks.layerSubprocess), Effect.provide(NodeServices.layer));
  ```

  Two new composites wire it through the higher-level layers, each requiring core's `ChildProcessSpawner` in `R`:

  * `WorkspaceCatalogs.layerWithConfigDependenciesSubprocess(options?)`
  * `Workspaces.layerWithConfigDependenciesSubprocess(options?)`

  No existing surface changed or removed. [#288][#288]

### Dependencies

| Dependency         | Type       | Action  | From  | To    |
| ------------------ | ---------- | ------- | ----- | ----- |
| @effected/commands | dependency | updated | 0.2.1 | 0.3.0 |
| @effected/npm      | dependency | updated | 0.8.2 | 0.8.3 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#288]: https://github.com/spencerbeggs/effected/pull/288

## 0.9.6

### Performance

* `WorkspaceDiscovery.getPackage` and the `workspaceResolver` layer's `versionOf` now look names up through a name index cached against the memoized package list, instead of scanning the list on every call.

  * Duplicate package names still resolve to the first matching package, unchanged from the previous linear scan [#277][#277]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#277]: https://github.com/spencerbeggs/effected/pull/277

## 0.9.5

### Dependencies

| Dependency             | Type       | Action  | From  | To    |
| ---------------------- | ---------- | ------- | ----- | ----- |
| @effected/lockfiles    | dependency | updated | 0.3.1 | 0.3.2 |
| @effected/npm          | dependency | updated | 0.8.1 | 0.8.2 |
| @effected/package-json | dependency | updated | 0.7.2 | 0.7.3 |
| @effected/semver       | dependency | updated | 0.3.1 | 0.3.2 |

* | Dependency             | Type       | Action  | From  | To    |                                                          |
  | ---------------------- | ---------- | ------- | ----- | ----- | -------------------------------------------------------- |
  | @effected/package-json | dependency | updated | 0.7.2 | 0.7.3 |                                                          |
  | @effected/semver       | dependency | updated | 0.3.1 | 0.3.2 | Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

## 0.9.4

### Dependencies

| Dependency             | Type       | Action  | From  | To    |
| ---------------------- | ---------- | ------- | ----- | ----- |
| @effected/commands     | dependency | updated | 0.2.0 | 0.2.1 |
| @effected/git          | dependency | updated | 0.5.1 | 0.5.2 |
| @effected/glob         | dependency | updated | 0.2.1 | 0.2.2 |
| @effected/lockfiles    | dependency | updated | 0.3.0 | 0.3.1 |
| @effected/npm          | dependency | updated | 0.8.0 | 0.8.1 |
| @effected/package-json | dependency | updated | 0.7.1 | 0.7.2 |
| @effected/semver       | dependency | updated | 0.3.0 | 0.3.1 |
| @effected/walker       | dependency | updated | 0.3.3 | 0.3.4 |
| @effected/yaml         | dependency | updated | 0.6.0 | 0.6.1 |

### Maintenance

* Switching internal dependency versioning from `~` to `^` ranges.

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.9.3

### Dependencies

| Dependency             | Type       | Action  | From  | To    |
| ---------------------- | ---------- | ------- | ----- | ----- |
| @effected/lockfiles    | dependency | updated | 0.2.3 | 0.3.0 |
| @effected/npm          | dependency | updated | 0.7.0 | 0.8.0 |
| @effected/package-json | dependency | updated | 0.7.0 | 0.7.1 |

## 0.9.2

### Dependencies

| Dependency             | Type       | Action  | From  | To    |
| ---------------------- | ---------- | ------- | ----- | ----- |
| @effected/lockfiles    | dependency | updated | 0.2.2 | 0.2.3 |
| @effected/npm          | dependency | updated | 0.6.0 | 0.7.0 |
| @effected/package-json | dependency | updated | 0.6.1 | 0.7.0 |
| @effected/semver       | dependency | updated | 0.2.1 | 0.3.0 |

## 0.9.1

### Bug Fixes

* `WorkspaceSnapshots`' internal cache key now separates the workspace root and
  ref with a `\0` escape instead of a literal NUL byte. The literal byte made
  `file` classify the source as binary, so `grep`/`ripgrep` silently skipped it.

### Documentation

* Corrects two defects in the changelog published with `0.9.0`:

  * **The `PublishabilityDetector` requirement claim was wrong.** `Workspaces.layer`,
    `layerWithGit` and `layerWithConfigDependencies` neither provide nor require a
    `PublishabilityDetector` — nothing inside any of them asks a publishability
    question, so their `R` stays `FileSystem | Path`. The requirement surfaces in
    the `R` of the consuming *operation* that asks (`VersioningStrategy.detect`,
    for example), which can be well past the layer-wiring site.
  * **The recommended wiring was backwards.** The published note suggested
    `Workspaces.layer().pipe(Layer.provide(PublishabilityDetector.layerNpm))`.
    Since the composite doesn't require a detector, `Layer.provide` discards it —
    it never reaches the program's `R`. Wire it with `Layer.mergeAll` instead:

  ```ts
  // Wrong — discards the detector, since the composite doesn't require one
  const layer = Workspaces.layer().pipe(Layer.provide(PublishabilityDetector.layerNpm));

  // Correct
  const layer = Layer.mergeAll(Workspaces.layer(), PublishabilityDetector.layerNpm);
  ```

  Also: `Workspaces.layer`'s internal `localExecLayer` now passes `scriptPrefix`
  through when building an `ExecContext`, keeping pace with `@effected/commands`'
  new script-runner prefixes. [#191][#191]

### Dependencies

| Dependency             | Type       | Action  | From  | To    |
| ---------------------- | ---------- | ------- | ----- | ----- |
| @effected/commands     | dependency | updated | 0.1.0 | 0.2.0 |
| @effected/lockfiles    | dependency | updated | 0.2.1 | 0.2.2 |
| @effected/npm          | dependency | updated | 0.5.0 | 0.6.0 |
| @effected/package-json | dependency | updated | 0.6.0 | 0.6.1 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#191]: https://github.com/spencerbeggs/effected/pull/191

## 0.9.0

### Breaking Changes

* ### `PublishabilityDetector` no longer has an ambient default

  The bare `PublishabilityDetector.layer` is **removed**. `Workspaces.layer`,
  `layerWithGit` and `layerWithConfigDependencies` now all **require**
  `PublishabilityDetector` in `R` instead of silently supplying npm semantics —
  the old default made `Layer.mergeAll(myDetector, Workspaces.layer())` resolve
  to the default rather than the override, because `mergeAll` is last-wins, with
  no type error to catch it.

  Provide a policy explicitly:

  ```ts
  import { PublishabilityDetector, Workspaces } from "@effected/workspaces";
  import { Layer } from "effect";

  const WorkspacesLayer = Workspaces.layer().pipe(Layer.provide(PublishabilityDetector.layerNpm));
  ```

  `PublishabilityDetector.layerNpm` replaces the old `.layer` (standard npm
  semantics); `PublishabilityDetector.layerNone` is a workspace where nothing
  publishes. Each is also exposed as a plain value — `PublishabilityDetector.npm`
  / `.none` — for composing a policy that defers to one of them.

  ### `ReleaseTag`'s default version prefix is now `""`

  `ReleaseTag.single` / `ReleaseTag.scoped` default `versionPrefix` to `""`
  (strict SemVer) uniformly, rather than defaulting unscoped package names to a
  `"v"` prefix. A consumer relying on the old `v`-prefixed tags for an unscoped
  package must now pass `versionPrefix: "v"` explicitly.

### Features

* ### `ReleaseTag` and `TrackingTag`

  `ReleaseTag.single` / `.scoped` format a release's git tag name.
  `TrackingTag.forVersion` derives the floating-alias tags a version should
  carry (`v1`, `v1.2`) and never floats onto a prerelease; `TrackingTag.classifyTag`
  tells a version tag from an alias tag by segment count.

  ### `VersioningStrategy`

  `VersioningStrategy.classify` / `.detect` / `.tagsFor` — classify a package's
  versioning shape and compute the tags a release should push.

  ### `PackageManagerDetector` gains a standalone and declaration tier

  Detection now runs three tiers: workspace markers, then a standalone tier
  (lockfile presence with no workspace config), then a declaration tier
  (`packageManager` / `devEngines.packageManager` with no lockfile at all — a
  fresh clone before its first install). `PackageManagerDetector.makeTest` /
  `layerTest` are the sanctioned test doubles; an unstubbed `detect` dies rather
  than guessing.

  ### `localExecLayer` implements `@effected/commands`' `LocalExec`

  `Workspaces.localExecLayer` teaches `@effected/commands`' `ToolDiscovery` how
  to run a workspace's own package-manager binaries, resolving against the
  workspace root rather than the caller's `cwd`.

  `Workspaces` is now a static class rather than an `as const` namespace object;
  call syntax (`Workspaces.layer(...)`) is unchanged. [#180][#180]

### Dependencies

| Dependency             | Type       | Action  | From  | To    |
| ---------------------- | ---------- | ------- | ----- | ----- |
| @effected/commands     | dependency | updated | 0.0.0 | 0.1.0 |
| @effected/git          | dependency | updated | 0.5.0 | 0.5.1 |
| @effected/lockfiles    | dependency | updated | 0.2.0 | 0.2.1 |
| @effected/npm          | dependency | updated | 0.4.0 | 0.5.0 |
| @effected/package-json | dependency | updated | 0.5.2 | 0.6.0 |
| @effected/walker       | dependency | updated | 0.3.2 | 0.3.3 |

* | Dependency         | Type       | Action | From | To    |                                                                       |
  | ------------------ | ---------- | ------ | ---- | ----- | --------------------------------------------------------------------- |
  | @effected/commands | dependency | added  | —    | 0.0.0 | [#180][#180] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#180]: https://github.com/spencerbeggs/effected/pull/180

## 0.8.0

### Features

* ### Test doubles for the three remaining services

  `WorkspaceCatalogs`, `WorkspaceSnapshots` and `LockfileReader` gain `makeTest` and `layerTest`, matching `WorkspaceRoot` and `WorkspaceDiscovery`. Every service in the package now ships one, so a consumer extends the double instead of implementing the shape by hand.

  ```ts
  const layer = WorkspaceCatalogs.layerTest({
    set: () => Effect.succeed(catalogSet),
  });
  ```

  An unstubbed method dies with a named message rather than returning an empty value — an empty catalog set reads as a legitimate answer and makes every dependency look newly added. Where a method is honestly derivable from a supplied override it derives using the live logic, so a stubbed `set` answers `resolveSpecifier` and a stubbed `read` answers `resolvedVersion`.

### Documentation

* The README covers the `@effected/workspaces/node-sync` subpath and its `nodeSyncOps` preset, so the synchronous escape hatch no longer reads as though the operations must be hand-written [#175][#175]

### Dependencies

| Dependency             | Type       | Action  | From   | To    |
| ---------------------- | ---------- | ------- | ------ | ----- |
| @effected/git          | dependency | updated | 0.4.2  | 0.5.0 |
| @effected/lockfiles    | dependency | updated | 0.1.10 | 0.2.0 |
| @effected/npm          | dependency | updated | 0.3.1  | 0.4.0 |
| @effected/package-json | dependency | updated | 0.5.1  | 0.5.2 |
| @effected/yaml         | dependency | updated | 0.5.1  | 0.6.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#175]: https://github.com/spencerbeggs/effected/pull/175

## 0.7.0

### Features

* ### Per-importer specifier resolution

  `WorkspaceStateSnapshot.resolveIn(importerPath, dependency, specifier)` resolves a specifier scoped to one importer, where `importerPath` is the value `PackageStateSnapshot.relativePath` carries (`"."` for the root package).

  `resolve` answers workspace-wide and must abstain when two importers record different versions of the same dependency, because no single answer is correct. `resolveIn` has the importer in hand and answers exactly. Prefer it whenever the caller knows which package is asking.

  ```ts
  // Two packages holding different versions of the same dependency:
  snapshot.resolve("effect", "catalog:effect:peers");                  // Option.none()
  snapshot.resolveIn(".", "effect", "catalog:effect:peers");           // Option.some("1.0.0")
  snapshot.resolveIn("packages/a", "effect", "catalog:effect:peers");  // Option.some("2.0.0")
  ```

  ### Recorded importer versions on the snapshot and the catalog service

  * `WorkspaceStateSnapshot.importerVersions` — a new optional field carrying importer path to dependency name to resolved version. It is optional so a snapshot serialized before this release still decodes; an absent index makes the fallback inert, which is the behavior those values were captured under.
  * `WorkspaceCatalogs.importerVersions()` — the same index for the live workspace, assembled from the same single lockfile read as `set()` and memoized with it. No second read is performed.
  * `ImporterVersions` is exported as a new public type.

  `WorkspaceCatalogsShape` gains a required `importerVersions` member. Consuming the service is unaffected; a hand-written implementation of that interface would need the new member. [#167][#167]

### Bug Fixes

* A `catalog:` specifier that no committed catalog source declares now resolves to the concrete version the lockfile recorded, instead of resolving to nothing on both sides of a diff and hiding a real dependency bump.

  This is the shape a pnpm config-dependency pnpmfile hook produces. A workspace declaring `"effect": "catalog:effect:peers"` has that catalog injected at install time, so it appears in neither `pnpm-workspace.yaml` nor the lockfile's `catalogs:` block — pnpm does not record a peer-only catalog. A consumer diffing two snapshots saw the same unresolvable string on both sides, so a genuine `4.0.0-beta.99` to `4.0.0-beta.101` move produced no row and no changeset.

  `WorkspaceStateSnapshot.resolve` now falls back to the snapshot's recorded importer versions when the catalog set cannot answer a `catalog:` specifier, and only then. A plain range is unaffected — it is already its own answer.

  The fallback reads only committed data, so `WorkspaceSnapshots.at(ref)` and `worktree()` answer identically. Resolving the injected catalog on the worktree side alone would report every run as a change from the raw specifier string to a version.

  * Versions are normalized: pnpm's peer-disambiguation suffix (`1.2.3(effect@4.0.0)`) is stripped, so a dependency table shows `1.2.3` rather than the whole parenthesized chain
  * `link:` and `file:` importer entries are skipped — a filesystem edge is not a version
  * Only pnpm records importer versions; bun and npm workspaces are unaffected

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#167]: https://github.com/spencerbeggs/effected/pull/167

## 0.6.2

### Dependencies

| Dependency             | Type       | Action  | From  | To     |
| ---------------------- | ---------- | ------- | ----- | ------ |
| @effected/git          | dependency | updated | 0.4.1 | 0.4.2  |
| @effected/glob         | dependency | updated | 0.2.0 | 0.2.1  |
| @effected/lockfiles    | dependency | updated | 0.1.9 | 0.1.10 |
| @effected/npm          | dependency | updated | 0.3.0 | 0.3.1  |
| @effected/package-json | dependency | updated | 0.5.0 | 0.5.1  |
| @effected/semver       | dependency | updated | 0.2.0 | 0.2.1  |
| @effected/walker       | dependency | updated | 0.3.1 | 0.3.2  |
| @effected/yaml         | dependency | updated | 0.5.0 | 0.5.1  |

* | Dependency | Type           | Action  | From          | To             |                                                                       |
  | ---------- | -------------- | ------- | ------------- | -------------- | --------------------------------------------------------------------- |
  | effect     | peerDependency | updated | 4.0.0-beta.99 | 4.0.0-beta.101 | [#162][#162] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#162]: https://github.com/spencerbeggs/effected/pull/162

## 0.6.1

### Dependencies

| Dependency             | Type       | Action  | From  | To    |
| ---------------------- | ---------- | ------- | ----- | ----- |
| @effected/package-json | dependency | updated | 0.4.2 | 0.5.0 |

## 0.6.0

### Breaking Changes

* ### `ConfigDependencyHooks.inject` returns `HookInjection`, not a bare catalogs record

  `inject` previously resolved to the catalogs a replayed `updateConfig` hook
  produced. It now resolves to a `HookInjection`:

  ```ts
  interface HookInjection {
  	readonly catalogs: Readonly<Record<string, Readonly<Record<string, string>>>>;
  	readonly releaseAge: PartialReleaseAgeGate;
  }
  ```

  One hook replay now yields both the catalogs and the release-age keys
  (`minimumReleaseAge` / `minimumReleaseAgeExclude`) the hooks leave on the
  config, so the config-dependency code — which executes arbitrary
  `pnpmfile.cjs` logic — still runs exactly once. When two hooks both set a
  release-age key, the later hook wins. `ConfigDependencyHooks.layerNoop` now
  returns `{ catalogs: seed, releaseAge: {} }` instead of the bare seed. A
  caller that awaited `inject` directly and read the catalogs off the resolved
  value needs to read `.catalogs` instead.

### Features

* ### `WorkspaceCatalogs.releaseAgeGate()`

  Assembles the workspace's effective pnpm release-age gate from inline
  `pnpm-workspace.yaml` keys and the replayed config-dependency hooks,
  strictest-wins via `ReleaseAgeGate.combine`, in the same single memoized
  assembly pass as `set()`:

  ```ts
  import { WorkspaceCatalogs } from "@effected/workspaces";

  const program = Effect.gen(function* () {
  	const catalogs = yield* WorkspaceCatalogs;
  	const gate = yield* catalogs.releaseAgeGate();
  	// gate.ageMinutes, gate.exclude
  });
  ```

  A present-but-malformed inline `minimumReleaseAge` or
  `minimumReleaseAgeExclude` now fails typed as `CatalogAssemblyError`
  (`source: "manifest"`) instead of being silently ignored — a silently-dropped
  gate is exactly the "install refuses a version the resolver already picked"
  bug this vocabulary exists to prevent. A workspace with no
  `pnpm-workspace.yaml` (a bun/npm workspace) has no release-age keys, so the
  gate is the inert zero gate. `HookInjection` is exported from the package. [#139][#139]

### Dependencies

| Dependency             | Type       | Action  | From  | To    |
| ---------------------- | ---------- | ------- | ----- | ----- |
| @effected/lockfiles    | dependency | updated | 0.1.8 | 0.1.9 |
| @effected/npm          | dependency | updated | 0.2.3 | 0.3.0 |
| @effected/package-json | dependency | updated | 0.4.1 | 0.4.2 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#139]: https://github.com/spencerbeggs/effected/pull/139

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
