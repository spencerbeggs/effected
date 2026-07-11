# @effected/workspaces

[![npm](https://img.shields.io/npm/v/@effected%2Fworkspaces?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/workspaces)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

Monorepo workspace tooling for [Effect](https://effect.website) v4: find the workspace root, enumerate its packages, walk the dependency graph, detect the package manager, resolve pnpm catalogs, read the lockfile, and work out which packages a git range touches. Every capability is a service you provide at the edge and swap in tests. Works with npm, pnpm, yarn Berry and bun.

## Why @effected/workspaces

Monorepo tooling keeps re-deriving the same facts: where the root is, which directories are packages, what depends on what, what a `catalog:` specifier means, and which packages a change affects. Each tool re-derives them slightly differently, and the differences show up as bugs. This package answers those questions once.

Discovery is honest about what a glob means. A `packages/**` pattern finds packages nested more than one level deep, because the enumerator does a bounded descent rather than the one-level approximation that a trailing-`**` rewrite quietly turns it into — and a package that goes undiscovered with no diagnostic is the worst kind of wrong, because an empty result is indistinguishable from a legitimately empty workspace. The same discipline runs through the error model: a malformed `package.json`, an unenumerable pattern, a missing lockfile and a failed git command all fail through the typed channel with structured fields, while a developer wiring mistake (an uncompilable glob literal, a fractional `maxDepth`) stays a defect. The typed channel is exactly the set of things a caller can branch on.

Git runs through a `GitReader` service rather than a hard-coded subprocess call, so change detection is testable with no repository on disk and portable to a runtime that spawns processes differently. And where `@effected/npm` declares the `CatalogResolver` and `WorkspaceResolver` seams — contracts that `@effected/package-json` consumes but no pure package can fill — this is the package that fills them.

## Install

```bash
npm install @effected/workspaces effect
```

```bash
pnpm add @effected/workspaces effect
```

Requires Node.js >=24.11.0. `effect` v4 is a peer dependency. You provide a `FileSystem` and `Path` implementation at the edge — `@effect/platform-node` or `@effect/platform-bun`.

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
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { ChangeDetectionOptions, ChangeDetector, Workspaces } from "@effected/workspaces";
import { Effect, Layer } from "effect";

// layerWithGit adds ChangeDetector over the Node GitReader.
const Platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
const WorkspacesLayer = Workspaces.layerWithGit().pipe(Layer.provide(Platform));

const program = Effect.gen(function* () {
  const detector = yield* ChangeDetector;
  const affected = yield* detector.affectedPackages(ChangeDetectionOptions.make({ base: "origin/main" }));
  return affected.map((pkg) => pkg.name);
});

Effect.runPromise(program.pipe(Effect.provide(WorkspacesLayer))).then(console.log);
// [ ...names of packages the range touched, plus everything downstream of them ]
```

Git is a separate layer rather than a flag, because the extra requirement is a subprocess: a consumer that never detects changes should not have to be able to spawn one. A test swaps `GitReader.layerNode` for a fake and needs no repository at all.

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

## The synchronous escape hatch

Vitest's config-time project discovery cannot await. Two functions exist for exactly that case, and they are **Node-only and synchronous**:

```ts
import { findWorkspaceRootSync, getWorkspacePackagesSync } from "@effected/workspaces";

const root = findWorkspaceRootSync();
const packages = root === null ? [] : getWorkspacePackagesSync(root);
// root: the workspace root path, or null when none is found above the cwd
// packages: the discovered workspace packages, empty when there is no root
```

Both entry points drive one traversal state machine — the same dequeue order, depth rule, visit budget and `node_modules` prune — so the sync and Effect surfaces can never disagree about what a pattern means. The one deliberate difference is at a bound: the Effect enumerator fails typed, the sync one truncates. Prefer the Effect API everywhere you can run one.

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

`WorkspaceRootNotFoundError`, `WorkspaceDiscoveryError`, `WorkspacePatternError`, `PackageNotFoundError`, `WorkspaceManifestError`, `PackageManagerDetectionError`, `CatalogAssemblyError`, `LockfileReadError`, `CyclicDependencyError`, `ChangeDetectionError` and `GitCommandError` each name one thing that can actually go wrong, and each method's error channel is narrowed to the ones it can produce.

## Features

- `Workspaces.layer` / `Workspaces.layerWithGit` / `Workspaces.resolvers` — the composite layers, split on requirements rather than feature flags: a filesystem, a filesystem plus a subprocess, and the two `@effected/npm` resolver contracts.
- `WorkspaceRoot` — root discovery from a `cwd`, over `WORKSPACE_MARKERS`.
- `WorkspaceDiscovery` — package enumeration with a bounded descent for segment-crossing `packages/**` patterns, plus per-package lookup.
- `WorkspacePackage` — a deliberately tolerant manifest model, so one member with an odd version cannot fail discovery for the whole repo. `WorkspacePackage.manifest(pkg)` is the opt-in bridge to `@effected/package-json`'s strict `Package`.
- `DependencyGraph` — a value class over discovered packages: `levels()` for parallel build tiers, the flattened topological order, and `CyclicDependencyError` when there isn't one.
- `PackageManagerDetector` — npm, pnpm, yarn or bun from lockfiles and the `packageManager` field.
- `WorkspaceCatalogs` — pnpm catalog assembly and `catalog:` resolution, on pnpm's own catalog packages.
- `LockfileReader` — locate and parse the workspace's lockfile through `@effected/lockfiles`.
- `ChangeDetector` and `GitReader` — git-range change detection over a swappable git contract.
- `PublishabilityDetector` — whether a package publishes and to where, as a `PublishTarget` (registry, directory, access, provenance). The default layer implements npm's semantics; swap the layer if yours differ.
- `findWorkspaceRootSync` / `getWorkspacePackagesSync` — the Node-only synchronous escape hatch for config-time callers that cannot await.

## License

[MIT](LICENSE)
