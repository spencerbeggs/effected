# @effected/ts-vfs

[![npm](https://img.shields.io/npm/v/@effected%2Fts-vfs?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/ts-vfs)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

TypeScript virtual file systems for Effect. `TypeRegistry` fetches a package's declaration files from npm through the jsDelivr CDN, caches them on disk, resolves an import specifier against the manifest that shipped with them, and hands the result to `@typescript/vfs` as a real `VirtualTypeScriptEnvironment` — so Twoslash-style documentation tooling can typecheck a code sample that imports a library the machine has never installed. Version references resolve locally with [`@effected/semver`](../semver), the cache's metadata plane is [`@effected/store`](../store)'s `Cache`, and the TypeScript compiler is an optional peer that only loads if you ask for one.

## Why @effected/ts-vfs

A docs site that typechecks its own examples needs the types of every package those examples import, and it needs them without a `node_modules` tree. That means fetching `.d.ts` files over the network, which means caching them, which means answering the question caching always asks: this entry is not live — is it *missing*, or merely *stale*?

The distinction is the package. A miss has to be fetched. A stale entry already has files on disk, so the build can refresh them or, offline, serve them as they are and keep working. Collapsing the two into a boolean makes the second behaviour impossible to express, and the failure mode is a docs build that dies on a plane.

Everything else follows from that. Paths that arrive from a CDN are untrusted data, not path fragments: absolute paths and `..` segments are rejected before any join, exports-map substitution skips dunder keys, recursion is depth-capped and `getTypeFiles` has a materialization budget. Load failures carry their typed cause structurally rather than a stringified message that something downstream has to pattern-match.

## Install

```bash
npm install @effected/ts-vfs effect @effected/store @effected/xdg @effected/semver
```

```bash
pnpm add @effected/ts-vfs effect @effected/store @effected/xdg @effected/semver
```

Requires Node.js >=24.11.0.

`dependencies` is empty. `effect` v4, `@effected/store`, `@effected/xdg` and `@effected/semver` are peer dependencies; `typescript` and `@typescript/vfs` are **optional** peers. Install the optional pair only if you call `TsEnvironment.make` — every other module works without a compiler on disk.

The store edge is load-bearing rather than incidental: store's `Cache` appears in `TypeCache.layer`'s requirements, so a single copy of it in your graph is the point, and that is why it is a peer. It is also what makes this package integrated tier — anything depending on `@effected/ts-vfs` inherits the SQLite driver.

## Quick start

`TypeRegistry` is the facade: one service over the cache, the fetcher and the resolver.

```ts
import { PackageSpec, TypeRegistry } from "@effected/ts-vfs";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const registry = yield* TypeRegistry;

  const version = yield* registry.resolveVersion("zod", "^3.23.0");
  // A dist-tag, exact version or range, pinned to one published version string.

  return yield* registry.getPackageVfs(PackageSpec.make({ name: "zod", version }));
  // Map<string, string> keyed "node_modules/zod/<path>.d.ts" → declaration source.
  // Fetched and cached on the first call; read from disk after.
});
```

Wiring composes at the edge: the platform layers, store's `Cache`, `TypeCache`, `PackageFetcher`, then the registry.

```ts
import { PackageFetcher, TypeCache, TypeRegistry } from "@effected/ts-vfs";
import { Cache } from "@effected/store";
import { NodeContext, NodeHttpClient } from "@effect/platform-node";
import { Layer } from "effect";

// Bind the built layer to a const. The statics are parameterized factories, so
// calling them at two provide sites mints two caches over the same directory.
const RegistryLive = TypeRegistry.layer.pipe(
  Layer.provide(Layer.mergeAll(TypeCache.layer({ cacheDir: "/var/tmp/my-docs/types" }), PackageFetcher.layer)),
  Layer.provide(Cache.layerSqlite({ filename: "/var/tmp/my-docs/types.db" })),
  Layer.provide(Layer.mergeAll(NodeHttpClient.layerUndici, NodeContext.layer)),
);
```

`TypeCache.layer` takes an absolute `cacheDir`; a relative one is developer wiring and dies at layer construction. `TypeCache.layerXdg({ namespace })` roots the file plane at `<AppDirs cache>/<namespace>/` instead and creates the directory through `AppDirs.ensureCache`, which also discharges store's constraint that a database's parent directory must exist before the SQLite layer is built. Either way this package never builds the store layer itself — you compose `Cache.layerSqlite`, or `Cache.layerTest` at `:memory:`, yourself.

## The two-plane cache

`TypeCache` keeps fetched files on disk under `<cacheDir>/<name>/<version>/` and per-package metadata in store's `Cache`, which brings TTL, evict-on-read expiry and bulk pruning with it. The seam between the planes is where the useful behaviour lives:

| State | Meaning | `autoFetch: true` (default) | `autoFetch: false` |
| ----- | ------- | --------------------------- | ------------------ |
| Live metadata | Hit | Serve from disk | Serve from disk |
| Files on disk, no live metadata | Stale | Refetch | Serve the stale files |
| Nothing | Miss | Fetch | Fail with `PackageNotFoundError` |

That last column is what an offline build wants: `getPackageVfs(spec, { autoFetch: false })` never touches the network, serves whatever it has, and tells you — typed — when it has nothing.

`remove` deletes metadata *before* files, so a crash between the two steps leaves harmless orphaned files that a later refetch overwrites, never a phantom cache hit. `prune` is best-effort and deliberately non-transactional, because file removals cannot ride a SQL transaction. Expiry reads store's clock, so `TestClock` drives it and no test sleeps.

## Batch loading

`getVfs` loads several packages concurrently and merges the results. It is best-effort by design: per-package failures accumulate, the partial VFS still merges, and it fails only when *every* package failed — with a `BatchLoadError` carrying each failure and its typed error. One package's 404 should not take a docs build down when the other nine resolved. An empty array is not an error; it is an empty VFS.

```ts
import { PackageSpec, TypeRegistry } from "@effected/ts-vfs";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const registry = yield* TypeRegistry;
  return yield* registry.getVfs([PackageSpec.fromString("zod@3.23.8"), PackageSpec.fromString("effect@latest")], {
    autoFetch: false,
  });
  // The merged Vfs of whatever loaded; BatchLoadError only if nothing did.
});
```

## Resolving imports

`TypeResolver` is pure statics — no service, no layer. Through the registry it answers the question a Twoslash sample actually asks: given `import { z } from "zod/v4"`, which `.d.ts` file is that?

```ts
import { PackageSpec, TypeRegistry } from "@effected/ts-vfs";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const registry = yield* TypeRegistry;
  const zod = PackageSpec.fromString("zod@3.23.8");

  const resolved = yield* registry.resolveImport(zod, "zod/v4");
  // Option<ResolvedModule> — None when the manifest offers no evidence for the subpath.

  return yield* registry.getTypeEntries(zod);
  // ReadonlyArray<ResolvedModule>: every declared type entry point.
});
```

`PackageSpec.normalizeSpecifier` turns an arbitrary import back into the package to fetch: `"node:fs"` and the other built-ins become `"node"` (the `@types/node` convention), `"@effect/platform/HttpClient"` becomes `"@effect/platform"`, `"lodash/fp"` becomes `"lodash"`.

## Virtual packages and a TypeScript environment

Not every declaration comes from npm. `VirtualPackage` builds a synthetic package out of declaration text you already have — API Extractor output, ambient declarations, the package the docs site is documenting — and drops it into the same VFS as the fetched ones. It never touches the disk cache. `TsEnvironment.make` then turns a `Vfs` plus compiler options into a `VirtualTypeScriptEnvironment` ready for a language service:

```ts
import { mergeVfs, TsEnvironment, VirtualPackage } from "@effected/ts-vfs";
import { Effect } from "effect";
import ts from "typescript";

const local = VirtualPackage.create("@my-org/api", "1.0.0", "export interface User { readonly id: string }");

const program = Effect.gen(function* () {
  const environment = yield* TsEnvironment.make({
    vfs: mergeVfs(remoteVfs, local.toVfs()),
    compilerOptions: { strict: true, target: ts.ScriptTarget.ES2022 },
  });

  environment.createFile("index.ts", `import type { User } from "@my-org/api";`);
  return environment.languageService.getSemanticDiagnostics("index.ts");
  // ReadonlyArray<ts.Diagnostic> — empty when the sample typechecks.
});
```

`TsEnvironment` is the only module that touches the optional peers, and it loads them lazily inside `make`: a consumer that never calls it never loads the compiler, and a missing peer fails as a typed `TsEnvironmentError` instead of crashing at import time. `createMultiEntry` generates the `exports` map for a multi-file virtual package; `fromFile` reads a `.d.ts` through Effect's `FileSystem`.

## Events

`RegistryObserver` is an opt-in event channel. Provide no observer and you pay nothing — every emission site resolves the service through `Effect.serviceOption` and no-ops on absence. The library never logs.

```ts
import { RegistryObserver } from "@effected/ts-vfs";

const ObserverLive = RegistryObserver.layerCallback((event) => {
  switch (event._tag) {
    case "CacheHit":
      return console.log(`${event.package} — cached`);
    case "PackageLoadFailed":
      return console.warn(`${event.package} failed: ${event.kind}`);
    default:
      return;
  }
});
```

`RegistryEvent` is a schema-backed tagged union — `VersionResolved`, `VersionResolveFailed`, `CacheHit`, `CacheStale`, `CacheMiss`, `FetchStart`, `FetchFailed`, `PackageLoaded`, `PackageLoadFailed`, `BatchStart`, `BatchComplete` — because events cross the library/host boundary and hosts ship them to telemetry. `PackageLoadFailed.kind` is computed from typed error tags and `FetchError.status`, never from substrings in a message. `RegistryObserver.layerNoop` is there when a test needs the service present and silent.

## Errors

| Tag | Means | Recovery |
| --- | --- | --- |
| `FetchError` | A jsDelivr request failed. Carries `url`, a `kind` of `status`, `body`, `schema` or `transport`, an optional `status` and the structural `cause`. | Retry a `transport` failure; a `schema` one means the CDN's shape moved. |
| `PackageNotFoundError` | The package does not exist on the CDN, or `autoFetch: false` found nothing cached. Carries `name` and `version`. | Check the spec, or fetch with `autoFetch` on. |
| `VersionNotFoundError` | No published version satisfies the reference. Carries `name`, `ref` and the `available` versions. | Widen the range; the available list is right there. |
| `TypeCacheError` | A cache operation failed: disk IO, metadata-store IO, or a path trying to escape the cache directory. Carries `operation`, `path` and the structural `cause`. | Usually a permissions problem; a rejected path means the CDN response was hostile. |
| `BatchLoadError` | Every package in a `getVfs` batch failed. Carries one entry per failure with its typed error preserved. | Inspect `failures` — the per-package causes are intact. |
| `TsEnvironmentError` | The optional `typescript` / `@typescript/vfs` peers could not be loaded, or the environment could not be built. Carries the structural `cause`. | Install the optional peers. |

## Features

- `TypeRegistry` — the facade: `resolveVersion`, `fetchAndCache`, `getPackageVfs`, `getVfs`, `resolveImport`, `getTypeEntries`, `hasCached`, `clearCache` and `pruneCache`, each with a precise error union.
- `TypeCache` — the two-plane cache: files on disk, metadata in store's `Cache`, with `layer` for an explicit directory and `layerXdg` for the XDG cache directory.
- `PackageFetcher` — the jsDelivr client: manifests, published-version and dist-tag maps, and the declaration file tree under a materialization budget.
- `TypeResolver` / `ResolvedModule` — pure exports-map resolution: `resolveImport`, `resolveTypeEntries`, `resolveMainEntry`, `findTypeDefinition`, hardened against wildcard blowups and prototype pollution.
- `PackageSpec` — the cache-key codec and specifier normalizer, with a schema that makes a directory-escaping name or version unconstructable.
- `VirtualPackage` — synthetic packages from declaration text (`create`, `createMultiEntry`, `fromFile`), merged into the same VFS as the fetched ones.
- `TsEnvironment` — the `@typescript/vfs` seam, loading the optional peers lazily and failing typed when they are absent.
- `RegistryEvent` / `RegistryObserver` — the schema-backed event union and the opt-in observer (`layerCallback`, `layerNoop`).
- `Vfs`, `mergeVfs`, `prefixVfs` — the currency type (`Map<string, string>`) and the two combinators everything else is expressed in.

## License

[MIT](LICENSE)
</content>
</invoke>
