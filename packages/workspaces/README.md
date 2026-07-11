# @effected/workspaces

[![npm](https://img.shields.io/npm/v/@effected%2Fworkspaces?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/workspaces)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

Monorepo workspace tooling for [Effect](https://effect.website) v4: find the workspace root, enumerate its packages, walk the dependency graph, detect the package manager, resolve pnpm catalogs, read the lockfile, and work out which packages a git range touches. Works with npm, pnpm, yarn Berry and bun.

## Why @effected/workspaces

Monorepo tooling keeps re-deriving the same facts: where the root is, which directories are packages, what depends on what, what a `catalog:` specifier means, and which packages a change affects. Each tool re-derives them slightly differently, and the differences show up as bugs. This package answers those questions once, as services you provide at the edge and swap in tests.

Discovery is honest about what a glob means. A `packages/**` pattern finds packages nested more than one level deep — the enumerator does a bounded recursive descent rather than the silent one-level approximation that shipped in the predecessor library. Malformed input fails through a typed error channel, never as a defect, and every error carries structured fields rather than a prose `reason` string.

## Install

```bash
npm install @effected/workspaces effect
```

```bash
pnpm add @effected/workspaces effect
```

Requires Node.js >=24.11.0. `effect` v4 is a peer dependency. You provide a `FileSystem` and `Path` implementation at the edge — `@effect/platform-node` or `@effect/platform-bun`.

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

  // Parallel build tiers: level 0 depends on nothing in the workspace.
  return yield* graph.levels();
});

Effect.runPromise(program.pipe(Effect.provide(WorkspacesLayer)));
```

## Change detection

`ChangeDetector` offers three depths of analysis on one service — raw files, the packages owning them, and the transitive blast radius through the dependency graph.

```ts
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { ChangeDetectionOptions, ChangeDetector, Workspaces } from "@effected/workspaces";
import { Effect, Layer } from "effect";

// layerWithGit adds ChangeDetector over the Node GitReader.
const Platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
const WorkspacesLayer = Workspaces.layerWithGit().pipe(Layer.provide(Platform));

const program = Effect.gen(function* () {
  const detector = yield* ChangeDetector;
  const affected = yield* detector.affectedPackages(
    ChangeDetectionOptions.make({ base: "origin/main" }),
  );
  return affected.map((pkg) => pkg.name);
});

Effect.runPromise(program.pipe(Effect.provide(WorkspacesLayer)));
```

Git runs through a `GitReader` service, not a hard-coded subprocess call — so a test provides a fake and needs no repository on disk, and a Bun or Deno consumer swaps the layer.

## pnpm catalogs

`WorkspaceCatalogs` assembles a workspace's catalogs with pnpm's precedence (the lockfile's record first, the inline `pnpm-workspace.yaml` declaration wins) and resolves `catalog:` specifiers against the result.

It also supplies the real implementations of `@effected/npm`'s `CatalogResolver` and `WorkspaceResolver` contracts — the ones `@effected/package-json` declares but cannot fill. Provide `Workspaces.resolvers` and a manifest's `catalog:` and `workspace:` specifiers resolve for real:

```ts
import { Package } from "@effected/package-json";
import { Workspaces } from "@effected/workspaces";
import { Layer } from "effect";

const WorkspacesLayer = Workspaces.layer();
const Resolvers = Workspaces.resolvers.pipe(Layer.provide(WorkspacesLayer));

// Package.resolve now rewrites `catalog:` and `workspace:` to concrete ranges.
```

## The synchronous escape hatch

Vitest's config-time project discovery cannot await. Two functions exist for exactly that case, and they are **Node-only and synchronous**:

```ts
import { findWorkspaceRootSync, getWorkspacePackagesSync } from "@effected/workspaces";

const root = findWorkspaceRootSync();
const packages = root === null ? [] : getWorkspacePackagesSync(root);
```

They share the enumerator with the Effect surface — including the `packages/**` descent — so the two never disagree about what a pattern means. Prefer the Effect API everywhere you can run one.

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

A malformed `package.json`, an unenumerable pattern, a missing lockfile and a failed git command all fail through the typed channel. A developer wiring mistake — an uncompilable glob literal, a fractional `maxDepth` — is a defect, so the typed channel stays the domain errors a caller actually branches on.

## License

MIT
