---
"@effected/ts-vfs": minor
---

## Features

Initial release of `@effected/ts-vfs` — the port of `type-registry-effect`: fetches, caches and resolves TypeScript type definitions from npm via the jsDelivr CDN, and builds `@typescript/vfs` environments so Twoslash-style documentation tooling can typecheck type-aware code samples.

```ts
import { PackageSpec, TypeRegistry } from "@effected/ts-vfs";
import { Effect } from "effect";

const program = Effect.gen(function* () {
	const registry = yield* TypeRegistry;
	const version = yield* registry.resolveVersion("zod", "^3.23.0");
	return yield* registry.getVfs([PackageSpec.make({ name: "zod", version })]);
});
```

### TypeRegistry (the facade)

One `Context.Service` replacing the v3 floating-function namespace: `hasCached`, `fetchAndCache`, `getPackageVfs`, `getVfs`, `resolveImport`, `getTypeEntries`, `resolveVersion`, `clearCache`, `pruneCache` — per-method error unions stay precise. Batch `getVfs` keeps the best-effort semantics (concurrency 5, per-package failure accumulation, merged partial results) and fails only when every package fails, with a structured `BatchLoadError` carrying each package's typed error. Version resolution is local: dist-tags via the CDN tag map, ranges via `@effected/semver` max-satisfying — no `/resolve` endpoint, no error-prose parsing; an unmatched ref is a typed `VersionNotFoundError`.

### TypeCache (the two-plane cache)

Files on disk under `<cacheDir>/<name>/<version>/`; metadata in `@effected/store`'s `Cache` with native TTL expiry, which drives the stale-vs-miss ladder (live metadata → hit; files with expired metadata → stale, refetched under `autoFetch` or served as-is; nothing → miss). Crash-ordering kept from v3: metadata deleted before files, so a crash leaves harmless orphans, never a phantom hit. `TypeCache.layer({ cacheDir })` for explicit roots, `TypeCache.layerXdg()` for `<AppDirs cache>/ts-vfs/` via `@effected/xdg`.

### PackageFetcher (the jsDelivr client)

30-second timeout, exponential retry on transport/timeout failures only, fail-fast on non-2xx with the status as a **structured field** — the 404 → `PackageNotFoundError` promotion and all event classification branch on typed data, never message substrings. Response validation is lenient (`PackageManifest`, the type-resolution subset) and schema failures normalize to `FetchError` `kind: "schema"` at the boundary.

### TypeResolver (pure statics)

`resolveImport` (exports map → `typesVersions` → root `types`/`typings`) returns `Option.none()` where v3 fabricated a guess; `resolveMainEntry` is total by the documented `index.d.ts` floor; `resolveTypeEntries` and `findTypeDefinition` round it out. No service, no layer, no fictional error channel.

### RegistryEvent / RegistryObserver

The v3 observer kept and upgraded: a schema-backed `RegistryEvent` union (`CacheHit`/`CacheStale`/`CacheMiss`, `FetchStart`/`FetchFailed`, `PackageLoaded`/`PackageLoadFailed` with a typed `kind`, `VersionResolved`/`VersionResolveFailed`, `BatchStart`/`BatchComplete`) emitted through an opt-in `RegistryObserver` resolved via `Effect.serviceOption` — zero cost and silent by default, `layerCallback` for non-Effect hosts. Durations come from the `Clock`.

### VirtualPackage and TsEnvironment

`VirtualPackage` (consumer-proven, subclass-friendly) builds synthetic packages from local declarations: `create`, `createMultiEntry`, `fromFile`, instance `toVfs()`. `TsEnvironment.make({ vfs, compilerOptions, projectRoot? })` builds a `VirtualTypeScriptEnvironment` over a `Vfs` plus the TS lib files, loading the optional `typescript` / `@typescript/vfs` peers lazily — a consumer that never calls it never loads the compiler, and a missing peer fails typed as `TsEnvironmentError`.

### Hardening

The resolution machinery treats CDN JSON as hostile: depth guards (`MAX_NESTING_DEPTH = 256`) on every recursive surface, prototype-pollution-safe wildcard substitution (null-prototype maps, dunder keys skipped, `Object.hasOwn`-only reads — fixing a live v3 `__proto__` defect), a one-wildcard bound before regex compilation (ReDoS guard), a 5 000-file / 64 MiB materialization budget on `getTypeFiles`, and rejection of absolute or `..`-bearing tree paths before any cache join. Malformed input always fails through the typed error channel.

### Typed errors

Six `Schema.TaggedErrorClass` types — `TypeCacheError`, `FetchError`, `PackageNotFoundError`, `VersionNotFoundError`, `BatchLoadError`, `TsEnvironmentError` — each carrying the underlying failure structurally in `cause` instead of a flattened message string. The v3 `*Base` export doubling, `TimeoutError`, `ParseError`, `ResolutionError`, the `/node` Promise API and the `Metric` surface are not ported.
