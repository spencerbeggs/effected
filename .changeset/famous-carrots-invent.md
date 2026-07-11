---
"@effected/workspaces": minor
---

## Features

Initial release of `@effected/workspaces` — monorepo workspace tooling as Effect services. Finds the workspace root, enumerates its packages, walks the dependency graph, detects the package manager, resolves pnpm catalogs, reads the lockfile, and works out which packages a git range touches. Supports npm, pnpm, yarn Berry and bun.

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

Effect.runPromise(program.pipe(Effect.provide(WorkspacesLayer)));
```

`Workspaces.layerWithGit()` adds `ChangeDetector`, whose `affectedPackages` walks the reverse dependency graph transitively. Git runs through a `GitReader` service contract with a Node `child_process` default layer, so a test provides a fake and needs no repository on disk.

`WorkspaceCatalogs` supplies the real implementations of `@effected/npm`'s `CatalogResolver` and `WorkspaceResolver` contracts — the ones `@effected/package-json` declares but cannot fill. Provide `Workspaces.resolvers` and a manifest's `catalog:` and `workspace:` specifiers resolve against the actual workspace instead of resolving to nothing.

`findWorkspaceRootSync` and `getWorkspacePackagesSync` are a Node-only synchronous escape hatch for callers that cannot run an Effect, such as a Vitest config building its project list. They share the enumerator with the Effect surface, so the two never disagree about what a pattern means.

`PackageManagerDetector` reads both fields that declare a package manager, and treats them the way corepack does. `devEngines.packageManager.name` is authoritative for the manager's name, because corepack errors when a top-level `packageManager` contradicts it. The top-level `packageManager` is authoritative for the exact version, because it is the field that carries the integrity hash. A repository declaring only `devEngines` is therefore no longer invisible to the version half of detection, and a manager named only by `devEngines` now disambiguates a bun or yarn lockfile. A version is reported only when the field it came from names the manager that was actually detected.

## Bug Fixes

A `packages/**` pattern now discovers packages nested more than one level deep. The predecessor library silently rewrote a trailing `/**` to `/*` during pattern compilation, so anything below the first level went undiscovered with no diagnostic. The enumerator instead does a bounded iterative descent, guarded by a depth cap, a visit budget and an unconditional `node_modules` and `.git` prune.

Cycle detection no longer recurses, so a long dependency chain cannot overflow the stack.

A root `package.json` that exists but cannot be read or parsed now fails package-manager detection with a typed `WorkspaceManifestError` instead of being silently treated as a manifest that declares no manager. A malformed `devEngines` hint is still ignored rather than fatal, matching corepack: a bad hint must never turn a detectable workspace into a detection failure.

## Other

Every error is a `Schema.TaggedErrorClass` with structured fields to branch on rather than a prose `reason` string. Malformed input always fails through the typed channel; a developer wiring mistake, such as an uncompilable glob literal or a fractional depth bound, stays a defect so the typed channel remains the domain errors a caller actually handles.

Lazy initialization memoizes success only. An interrupted first call retries rather than permanently poisoning the layer with a cause outside its declared error channel.

`minimatch` is not a runtime dependency: pattern matching runs on `@effected/glob`'s vendored engine at both call sites. The `@pnpm/catalogs.*` packages are the only external runtime dependencies, and they are confined to a single internal module.
