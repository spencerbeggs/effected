# @effected/workspaces

[![npm](https://img.shields.io/npm/v/@effected%2Fworkspaces?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/workspaces)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

Monorepo workspace tooling for [Effect](https://effect.website) v4: find the workspace root, enumerate its packages, walk the dependency graph, detect the package manager, resolve pnpm catalogs, read the lockfile and work out which packages a git range touches. Every capability is a service you provide at the edge and swap in tests. Works with npm, pnpm, yarn Berry and bun.

> **Pre-release.** This package is part of the `@effected/*` kit, in pre-`1.0.0`
> development against a single pinned Effect v4 beta. Packages graduate to
> `1.0.0` once Effect `4.0.0` ships. To hold your own `effect` versions at
> exactly the ones the kit is built and tested against, install
> [`@effected/pnpm-plugin-effect`](https://www.npmjs.com/package/@effected/pnpm-plugin-effect).
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version — even a
> package marked *stable* before `1.0.0` can introduce a breaking change by
> accident, and an exact pin turns that into a type-check error rather than a
> runtime surprise. Full policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Why @effected/workspaces

Monorepo tooling keeps re-deriving the same facts: where the root is, which directories are packages, what depends on what, what a `catalog:` specifier means and which packages a change affects. Each tool re-derives them slightly differently, and the differences show up as bugs. This package answers those questions once.

Discovery is honest about what a glob means. A `packages/**` pattern finds packages nested more than one level deep, because the enumerator does a bounded descent rather than the one-level approximation that a trailing-`**` rewrite quietly turns it into — and a package that goes undiscovered with no diagnostic is the worst kind of wrong, because an empty result is indistinguishable from a legitimately empty workspace. The same discipline runs through the error model: a malformed `package.json`, an unenumerable pattern, a missing lockfile and a failed git command all fail through the typed channel with structured fields, while a developer wiring mistake (an uncompilable glob literal, a fractional `maxDepth`) stays a defect. The typed channel is exactly the set of things a caller can branch on.

Git runs through `@effected/git`'s `Git` service rather than a hard-coded subprocess call, so change detection is testable with no repository on disk and portable to a runtime that spawns processes differently. And where `@effected/npm` declares the `CatalogResolver` and `WorkspaceResolver` seams — contracts that `@effected/package-json` consumes but no pure package can fill — this is the package that fills them.

## Install

```bash
npm install @effected/workspaces effect
```

```bash
pnpm add @effected/workspaces effect
```

Requires Node.js >=24.11.0. `effect` v4 is a peer dependency. You provide a `FileSystem` and `Path` implementation at the edge — `@effect/platform-node` or `@effect/platform-bun`.

All `@effected/*` packages are ESM-only: the exports maps publish only `import` conditions, so `require()` — including tools that resolve in CJS mode — fails with Node's `ERR_PACKAGE_PATH_NOT_EXPORTED` rather than loading a CJS build that does not exist. Import from an ES module.

pnpm's catalog semantics come from pnpm's own `@pnpm/catalogs.*` packages, which install as regular dependencies. Reimplementing them would mean owning a moving spec with no oracle, so they are used directly and confined to a single internal module.

## Quick start

```ts
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { DependencyGraph, WorkspaceDiscovery, Workspaces } from "@effected/workspaces";
import { Effect, Layer } from "effect";

// Bind the layer to a const: layers memoize by reference, so calling
// Workspaces.layer() twice builds the whole stack twice.
const Platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
const WorkspacesLayer = Workspaces.layer().pipe(Layer.provide(Platform));

const program = Effect.gen(function* () {
  const discovery = yield* WorkspaceDiscovery;

  const packages = yield* discovery.listPackages();
  const graph = DependencyGraph.make({ packages });

  // Parallel build tiers: level 0 depends on nothing in the workspace,
  // level n depends only on the levels below it.
  return yield* graph.levels();
});

Effect.runPromise(program.pipe(Effect.provide(WorkspacesLayer))).then(console.log);
// [ [ ...names with no workspace dependencies ], [ ...names that depend only on level 0 ], ... ]
```

`DependencyGraph` is a value class, not a service: build it from packages you already have. A cycle fails with `CyclicDependencyError` naming the packages that could not be ordered.

## Change detection

`ChangeDetector` offers three depths of analysis on one service — `changedFiles` (raw paths from a git range), `changedPackages` (the packages owning them) and `affectedPackages` (the transitive blast radius through the dependency graph).

```ts
import { NodeServices } from "@effect/platform-node";
import { ChangeDetectionOptions, ChangeDetector, Workspaces } from "@effected/workspaces";
import { Effect, Layer } from "effect";

// layerWithGit runs ChangeDetector over @effected/git's Git service; NodeServices
// provides the ChildProcessSpawner it needs, alongside FileSystem and Path.
const WorkspacesLayer = Workspaces.layerWithGit().pipe(Layer.provide(NodeServices.layer));

const program = Effect.gen(function* () {
  const detector = yield* ChangeDetector;
  const affected = yield* detector.affectedPackages(ChangeDetectionOptions.make({ base: "origin/main" }));
  return affected.map((pkg) => pkg.name);
});

Effect.runPromise(program.pipe(Effect.provide(WorkspacesLayer))).then(console.log);
// [ ...names of packages the range touched, plus everything downstream of them ]
```

Git is a separate layer rather than a flag, because the extra requirement is a subprocess: a consumer that never detects changes should not have to be able to spawn one. A test provides the `Git` service with a `Layer.succeed` stub and needs no repository at all.

## pnpm catalogs

`WorkspaceCatalogs` assembles a workspace's catalogs with pnpm's precedence (the lockfile's record first, the inline `pnpm-workspace.yaml` declaration wins) and resolves `catalog:` specifiers against the result.

It also supplies the real implementations of `@effected/npm`'s `CatalogResolver` and `WorkspaceResolver` contracts — the seams `@effected/package-json` reads through, which without a workspace under them can only answer `Option.none()`. Provide `Workspaces.resolvers` and `Package.resolve` rewrites `catalog:` and `workspace:` specifiers to concrete ranges:

```ts
import { Workspaces } from "@effected/workspaces";
import { Layer } from "effect";

const WorkspacesLayer = Workspaces.layer();
const Resolvers = Workspaces.resolvers.pipe(Layer.provide(WorkspacesLayer));
// Layer<CatalogResolver | WorkspaceResolver, never, FileSystem | Path>
```

`Workspaces.resolverLayer(options?)` is that wiring in one call: the two contracts over a full workspace stack, needing only `FileSystem` and `Path` from you. A fresh layer per call is the point — root discovery re-runs each time, including the `process.cwd()` read when `options.cwd` is omitted, so a build tool that changes directory between manifests stays correct. It wires the config-dependency replay path; compose `Workspaces.resolvers` with `Workspaces.layer` yourself if config-dependency code must not run.

For whole manifests, `Workspaces.resolveManifest` is the one-shot path over `@effected/npm`'s tolerant `Manifest` model:

```ts
import { Manifest } from "@effected/npm";
import { Workspaces } from "@effected/workspaces";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const manifest = yield* Manifest.decode({ dependencies: { effect: "catalog:" } });
  const resolved = manifest.needsResolution ? yield* Workspaces.resolveManifest(manifest) : manifest;
  return resolved.toRecord();
});
// needsResolution is pure — checking it first skips catalog assembly entirely
// when no dependency field carries a catalog: or workspace: specifier
```

A specifier the workspace cannot answer fails typed as `UnresolvedDependencyError`: at the manifest level "no catalog entry" means the manifest cannot be projected to concrete ranges.

## The synchronous escape hatch

Vitest's config-time project discovery cannot await. Two functions exist for exactly that case, and they run synchronously over file and path operations you supply — the module itself imports nothing platform-shaped, and Node's built-ins satisfy the operations one-liner each:

```ts
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";
import { findWorkspaceRootSync, getWorkspacePackagesSync } from "@effected/workspaces";

const options = {
  fileSystem: {
    exists: existsSync,
    readFile: (p: string) => readFileSync(p, "utf8"),
    readDirectory: (p: string) => readdirSync(p),
    isDirectory: (p: string) => statSync(p).isDirectory(),
  },
  path, // node:path satisfies SyncPath verbatim
};

const root = findWorkspaceRootSync(process.cwd(), options);
const packages = root === null ? [] : getWorkspacePackagesSync(root, options);
// root: the workspace root path, or null when none is found above the cwd
// packages: the discovered workspace packages, empty when there is no root
```

Windows correctness is the operations you pass — `node:path` on Windows is already win32-appropriate. Both entry points drive one traversal state machine (the same dequeue order, depth rule, visit budget and `node_modules` prune), so the sync and Effect surfaces can never disagree about what a pattern means. The one deliberate difference is at a bound: the Effect enumerator fails typed, the sync one truncates. Prefer the Effect API everywhere you can run one.

## Error handling

Every failure is a `Schema.TaggedErrorClass` with structured fields you can branch on, not a prose string:

```ts
import { WorkspaceDiscovery, WorkspacePatternError } from "@effected/workspaces";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const discovery = yield* WorkspaceDiscovery;
  return yield* discovery.listPackages();
}).pipe(
  Effect.catchTag("WorkspacePatternError", (error: WorkspacePatternError) =>
    // kind: "missingBaseDir" | "uncompilable" | "depthExceeded" | "budgetExceeded"
    Effect.logError(`pattern ${error.pattern} failed: ${error.kind}`).pipe(Effect.as([])),
  ),
);
```

`WorkspaceRootNotFoundError`, `WorkspaceDiscoveryError`, `WorkspacePatternError`, `PackageNotFoundError`, `WorkspaceManifestError`, `PackageManagerDetectionError`, `CatalogAssemblyError`, `LockfileReadError`, `CyclicDependencyError` and `ChangeDetectionError` each name one thing that can actually go wrong, and each method's error channel is narrowed to the ones it can produce. `CatalogAssemblyError` is defined in `@effected/npm`, beside the resolver contract that names it in its channel — import it from there. Change detection additionally surfaces `@effected/git`'s typed git errors, such as `NotARepositoryError`.

## Testing

Every service here can be replaced with `Layer.succeed` and a hand-built value, and `WorkspaceDiscovery` ships that pattern ready-made: `WorkspaceDiscovery.layerTest(overrides)` provides an in-memory double where a test stubs only the methods it exercises. The defaults model an empty workspace, and the derived methods run over the effective `listPackages`, so stubbing that one method keeps `getPackage`, `importerMap` and `resolveFile` answering consistently:

```ts
import { WorkspaceDiscovery, WorkspacePackage } from "@effected/workspaces";
import { Effect } from "effect";

// Bind to a const — layers memoize by reference.
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

A name miss in the derived `getPackage` fails with the service's own typed `PackageNotFoundError`, exactly as the live implementation does. Two deliberate edges: `info()` has no honest default (a fabricated root path would leak into consumer path logic), so it dies with an explanatory defect unless stubbed, and the derived file-ownership methods assume POSIX paths, so pass your own `resolveFile` for win32 fixtures. `WorkspaceDiscovery.makeTest(overrides)` returns the bare service shape when you want the double without a layer.

## Features

- `Workspaces.layer` / `Workspaces.layerWithGit` / `Workspaces.resolvers` — the composite layers, split on requirements rather than feature flags: a filesystem, a filesystem plus a subprocess, and the two `@effected/npm` resolver contracts.
- `Workspaces.resolverLayer` / `Workspaces.resolveManifest` — the one-call manifest-resolution path: a fresh, unmemoized layer per call so root discovery follows your cwd, and one-shot resolution of a whole `Manifest` against the real workspace.
- `WorkspaceRoot` — root discovery from a `cwd`, over `WORKSPACE_MARKERS`.
- `WorkspaceDiscovery` — package enumeration with a bounded descent for segment-crossing `packages/**` patterns, per-package lookup and the `makeTest` / `layerTest` in-memory test doubles.
- `WorkspacePackage` — a deliberately tolerant manifest model, so one member with an odd version cannot fail discovery for the whole repo. `manifestRecord` keeps the as-read `package.json` for tolerant access to fields outside the typed slice without a second read; `WorkspacePackage.manifest(pkg)` re-reads and is the opt-in bridge to `@effected/package-json`'s strict `Package`.
- `DependencyGraph` — a value class over discovered packages: `levels()` for parallel build tiers, the flattened topological order, and `CyclicDependencyError` when there isn't one.
- `PackageManagerDetector` — npm, pnpm, yarn or bun from lockfiles and the `packageManager` field.
- `WorkspaceCatalogs` — pnpm catalog assembly and `catalog:` resolution, on pnpm's own catalog packages.
- `LockfileReader` — locate and parse the workspace's lockfile through `@effected/lockfiles`.
- `ChangeDetector` — git-range change detection over `@effected/git`'s `Git` service; swap the layer to mock it with no repository.
- `PublishabilityDetector` — whether a package publishes and to where, as a `PublishTarget` (registry, directory, access, provenance). The default layer implements npm's semantics; swap the layer if yours differ.
- `findWorkspaceRootSync` / `getWorkspacePackagesSync` — the synchronous escape hatch for config-time callers that cannot await, over file and path operations you supply.

## License

[MIT](LICENSE)
