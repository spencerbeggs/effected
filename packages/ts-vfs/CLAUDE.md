# @effected/ts-vfs

TypeScript virtual file systems for Effect: fetches, caches and resolves type definitions from npm via the jsDelivr CDN, and builds `@typescript/vfs` environments so Twoslash-style documentation tooling can typecheck type-aware code samples. Fourteenth migration, the port of `type-registry-effect` (v3) under [the ts-vfs rename](../../.claude/design/effected/package-inventory.md). `rspress-plugin-api-extractor` is the consumer this API was designed against.

**Design doc:** `@../../.claude/design/effected/packages/ts-vfs.md` — load before changing the service shapes, the error model, the event union or the hardening guards.

## Tier: integrated

Twice over: by R2 through the `@effected/store` edge (store is tier 3 via `@effect/sql-sqlite-node`), and on its own surface through the optional `typescript` / `@typescript/vfs` peers. Every dependency is a **peer** (`@effected/store`, `@effected/xdg`, `@effected/semver` at `workspace:*`; `effect`; optional `typescript` + `@typescript/vfs`); `dependencies` is empty. Store's `Cache` appears in `TypeCache.layer`'s `R`, so a single copy in the consumer's graph is load-bearing — do not demote the store edge to a regular dependency.

## The two-plane cache

`TypeCache` keeps fetched `.d.ts` files on disk under `<cacheDir>/<name>/<version>/` and per-package metadata in store's `Cache` (native TTL, evict-on-read, bulk prune). The invariants worth not breaking:

- **Crash-ordering:** `remove` deletes metadata before files — a crash leaves harmless orphaned files, never a phantom hit. `prune` is best-effort/non-transactional on purpose (file removals cannot ride the SQL transaction).
- **Stale-vs-miss:** live metadata → hit; files on disk with no live metadata → stale (refetch when `autoFetch`, serve stale otherwise); nothing → miss. The distinction rides store's evict-on-read TTL — pinned by `TestClock` tests.
- **Paths from the CDN are data:** `write`/`read` reject absolute paths and `..` segments as typed `TypeCacheError`s before any join; `PackageSpec`'s schema checks make a name/version that could escape the cache directory unconstructable.
- The layer statics are **parameterized factories** — bind the built layer to a `const` or two provide sites mint two caches. `layerXdg` roots at `<AppDirs cache>/<namespace>` via `ensureCache`, which also discharges store's database-directory-must-exist constraint. This package never builds the store layer itself.

## Module map

One concept per module: `PackageSpec` (spec + cache-key codec + specifier normalization), `Vfs` (the currency type + `mergeVfs`/`prefixVfs`), `TypeCache`, `PackageFetcher` (jsDelivr client; owns `FetchError`/`PackageNotFoundError`/`VersionNotFoundError` and the lenient `PackageManifest`), `TypeResolver` (pure statics — no service, no layer), `TypeRegistry` (the facade service; owns `BatchLoadError`), `RegistryEvent` (schema-backed event union + `RegistryObserver`), `VirtualPackage`, `TsEnvironment`. Internals: `internal/jsdelivr.ts` (URLs, response structs), `internal/resolution.ts` (exports-map machinery), `internal/limits.ts` (the hardening constants).

## Hardening (do not relax)

The resolution machinery's input is JSON off a CDN — untrusted. `internal/limits.ts` holds the caps:

- `MAX_NESTING_DEPTH = 256` on every recursive surface (`substituteWildcard`, `extractTypesFromExport`, the cache-tree walk); past the guard resolution returns `Option.none()`, the walk fails typed.
- Wildcard patterns are bounded (`MAX_WILDCARDS_PER_PATTERN = 1`, npm semantics) before regex compilation — a pattern over the bound simply does not match (ReDoS guard).
- **Prototype pollution:** v3's `substituteWildcard` assigned `__proto__` from untrusted exports maps; the port builds substituted maps with `Object.create(null)`, skips dunder keys everywhere, and only reads untrusted objects through `Object.hasOwn`.
- `getTypeFiles` has a materialization budget (5 000 files / 64 MiB per package) failing typed as `FetchError` `kind: "body"`.

Each guard has a hostile-input test in `__test__/TypeResolver.test.ts` / `TypeCache.test.ts` / `PackageFetcher.test.ts`.

## The v4 facts this port tripped over (verified against beta.94)

- `HttpClientError` is a **single wrapper class** (`_tag: "HttpClientError"`) carrying a `reason` union — branch on `error.reason._tag === "TransportError"`, not on the top-level tag.
- `Effect.catchAll` → `Effect.catch`; `Effect.fork` → `Effect.forkChild`; best-effort swallow is `Effect.ignore`; `DateTime.distance(a, b)` returns a `Duration`.
- `Schema.Duration`/`Schema.DateTimeUtc` are `declare` schemas (no JSON encoding) — `TypeCacheMetadata` uses `Schema.DurationFromMillis` / `Schema.DateTimeUtcFromString` plus `Schema.fromJsonString` so it round-trips through the store's bytes.
- `@typescript/vfs`'s `createFSBackedSystem` does NOT resolve bare `node_modules/…` map keys — `TsEnvironment.make` re-roots every relative Vfs key under `projectRoot` (probed; the v3 code only worked because the real filesystem fallback shadowed the bug).
- `typescript` and `@typescript/vfs` are loaded **lazily inside `TsEnvironment.make`** (dynamic import, failure → typed `TsEnvironmentError`), because the monorepo publishes no subpath entrypoints and a static import would crash any consumer without the optional peers installed at index-import time.

## Events

`RegistryEvent` is a `Schema.Union` of `TaggedStruct`s; `RegistryObserver` is the opt-in observer (resolved via `Effect.serviceOption` — zero cost, no signature pollution, silent by default). The library never `Effect.log`s. ts-vfs keeps the observer posture (push callback, no `Scope`) while store's `Cache` keeps its `PubSub` — both deliberate, do not unify. `PackageLoadFailed.kind` and the 404 promotion are computed from typed error tags and the structured `FetchError.status` — never reintroduce message-substring classification (the v3 `classifyLoadError` defect).

## Testing and building

`@effect/vitest`, `it.effect`, `assert.*` — never `expect`. TypeCache/TypeRegistry suites run over a real temp dir + store `Cache.layerTest` (`:memory:`); there is no in-memory `FileSystem` in the beta (probed — only `layerNoop` stubs). TTL/stale paths are driven by `TestClock.adjust`; note the clock and the `:memory:` store are **shared across a `layer(...)` group**, so tests use distinct package specs and the prune test pre-flushes. The e2e suite (`__test__/e2e/jsdelivr.e2e.test.ts`) hits the live CDN and is opt-in: `TS_VFS_E2E=1`.

```bash
pnpm vitest run packages/ts-vfs          # from the repo root
pnpm build --filter @effected/ts-vfs     # from the repo root
```

`savvy.build.ts` carries the standard narrow `ae-forgotten-export` / `_base` suppression. Never run `node savvy.build.ts --target prod` directly — it skips `build:dev`, emits no `.d.ts`, and leaves a truncated `issues.json` shaped exactly like a clean gate.
