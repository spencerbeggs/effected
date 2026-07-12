---
status: current
module: effected
category: architecture
created: 2026-07-11
updated: 2026-07-12
last-synced: 2026-07-11
completeness: 90
related:
  - ../effect-standards.md
  - ../migration-playbook.md
  - ../package-inventory.md
  - ../releases.md
  - ../package-setup.md
  - store.md
  - xdg.md
  - semver.md
  - config-file.md
  - app.md
---

# @effected/ts-vfs design

## Overview

Design for `@effected/ts-vfs`, the **fourteenth** package migration ([migration-playbook.md](../migration-playbook.md)) and the second **integrated-tier** package after [store](store.md). It is the port of `type-registry-effect` (v3), renamed per [the ts-vfs rename](../package-inventory.md#the-ts-vfs-rename): the package fetches, caches and resolves TypeScript type definitions from npm (via the jsDelivr CDN) so that Twoslash-style documentation tooling can typecheck type-aware code samples, and it wraps `@typescript/vfs`. It is [load-bearing for two of the five gate applications](../releases.md#the-five-applications): it is a migration target itself, and `rspress-plugin-api-extractor` depends on it.

Status: **merged** (playbook steps 2–4 complete). Per the [store](store.md) and [xdg](xdg.md) precedent this doc now records the *as-built* design, with deviations from the approved draft marked inline as "As-built:". It was written from the [v3 review](../../../reviews/type-registry.md) and a fresh read of the v3 source and the rspress consumer, then reconciled against the port.

Gates: typecheck green across all 31 turbo tasks; a cold `pnpm build --filter @effected/ts-vfs` produces a zero-warning `dist/prod/issues.json` (0 warnings, 0 errors, 14 suppressed — every one an `ae-forgotten-export` on a synthesized `*_base`); **82 package tests pass plus one opt-in e2e suite** that is skipped by default and was verified live once against jsDelivr; the whole repo is green with that one skip and no regressions; lint clean; `pnpm peers check` clean (it showed only the known tooling-chain residual at the time; since the pnpm 11.12.0 upgrade there is no residual and the check is clean outright).

The PR #67 review added a further round of as-built hardening — a shared safe-relative-path invariant enforced *before* a `ResolvedModule` exists, per-package mutation serialization, a both-planes cache-hit rule, Node fallback arrays in `exports`, and a pre-download size budget. Each is recorded inline below, in the section that owns it.

Three findings are worth carrying into `@effected/app`, because that is the package that does this wiring for real (it took all three; it took **no dependency** on this package — see [app.md](app.md#no-effectedts-vfs-edge)): the [lazy compiler import](#tsenvironment--the-typescriptvfs-seam) that is the only thing making the `typescript` peers genuinely optional, the [`createFSBackedSystem` rooting rule](#tsenvironment--the-typescriptvfs-seam) that v3 was accidentally shielded from, and the [`DateTimeUtc`/`Duration` JSON-encoding gap](#typecache--the-two-plane-cache) on beta.94.

The v3 package got four things right that survive as concepts (review §1): the opt-in typed **observer channel** resolved via `Effect.serviceOption`; the **two-plane cache** (files on disk, metadata in SQLite with native TTL) with reasoned crash-ordering; the **best-effort batch semantics** (per-package failure accumulation, fail only when all fail); and `VirtualPackage`, which the rspress consumer builds on directly. Everything else — the kind-based folder sprawl, the `*Base` export doubling, the stringly error ladder and its `classifyLoadError` substring matching, the per-call layer rebuild in the Promise API — is redesigned.

## Tier and dependencies

**Integrated tier**, twice over: by [R2](../effect-standards.md#dependency-policy) through the `@effected/store` edge (store is tier 3 via `@effect/sql-sqlite-node`), and on its own surface through the `typescript` / `@typescript/vfs` peers. This is the anticipated assignment in [package-inventory.md](../package-inventory.md) and it is confirmed here.

- `peerDependencies`:
  - `effect` (`catalog:effect`).
  - `@effected/store` (`workspace:*`) — the metadata plane. Store's `Cache` service appears in `TypeCache.layer`'s `R`, so a single copy in the consumer's graph is load-bearing: peer, not regular dependency.
  - `@effected/xdg` (`workspace:*`) — supplies the cache *path* (`AppDirs`), exactly the seam the store split promised. Appears in `layerXdg`'s `R`: peer.
  - `@effected/semver` (`workspace:*`) — local version-range resolution (see [resolveVersion](#resolveversion-goes-local)). Range/SemVer types appear in no public signature, but the kit convention for `@effected/*` edges that pure-to-pure share one `effect` is peer; decided per edge at port time if the surface stays internal.
  - `typescript` + `@typescript/vfs` — **optional peers**, needed only by the `TsEnvironment` module. Module-level isolation is what makes optional viable: the codecs precedent from [the config-file consolidation](config-file.md#the-consolidation-2026-07-11) — one module, free-standing named exports, no namespace object — means a consumer that never imports `TsEnvironment` never loads (or bundles) the TypeScript compiler.

  **As-built: module isolation was necessary and not sufficient, and the gap is the port's sharpest lesson.** This package publishes no subpath exports, and `index.ts` re-exports `TsEnvironment` along with everything else. So a consumer importing *anything* from `@effected/ts-vfs` pulls `TsEnvironment.ts` into the module graph, and a **static** `import * as ts from "typescript"` there would be evaluated at import time — crashing every consumer who took the optional peers at their word and did not install them. Optional peers plus a static import of them is a contradiction the type system does not catch. The port therefore loads both packages **lazily**: the value imports are a `Promise.all([import("typescript"), import("@typescript/vfs")])` inside `TsEnvironment.make`, wrapped in `Effect.tryPromise` so a missing peer surfaces as a typed `TsEnvironmentError` rather than an import-time throw. The type-level imports stay static and erase.

  The doc's claim that a consumer "never loads (or bundles) the TypeScript compiler" therefore **holds — but on the lazy import, not on module isolation alone.** Module isolation is what lets a bundler tree-shake `TsEnvironment` out; the dynamic import is what keeps the unbundled Node consumer alive. Both are load-bearing; neither substitutes for the other.
- `dependencies`: none — as built, the manifest has no `dependencies` key at all.
- `devDependencies`: mirror the peers, plus the standard build/test set (`@savvy-web/bundler`, `@effect/tsgo` at `catalog:effect`, `@effect/vitest`). As-built it also carries **`@effect/platform-node`**, for the reason recorded under [Testing](#testing): effect core ships no in-memory `FileSystem`, so the disk plane is tested against real temp directories. It is a devDependency and reaches no consumer.

**Deleted dependencies, each with its reason recorded** (review §6):

- `@effect/sql` + `@effect/sql-sqlite-node` — existed in v3 solely to satisfy `xdg-effect`'s optional peers, never imported. The whole SQL surface now lives behind `@effected/store`; ts-vfs declares no sql packages.
- `@effect/platform` — dissolved into `effect` core in v4 (`FileSystem`, `Path`, `HttpClient` arrive via `R`).
- `@effect/platform-node` — was an optional peer for the `/node` entry, which is not ported (see [What is deliberately not ported](#what-is-deliberately-not-ported)).
- `semver-effect` — was declared and never imported; replaced by a *used* `@effected/semver` edge.
- **`@effected/package-json` is deliberately not taken.** Its schemas validate strictly (branded names, SPDX licenses); the manifests this package decodes come off a CDN and include every historical malformation npm ever published. Validation here must be lenient and scoped to the type-resolution subset, so the package keeps a small internal `Schema.Struct` for exactly the fields the resolver reads. Revisit only if package-json grows a lenient/partial profile.

## Module layout

Module-per-concept:

```text
packages/ts-vfs/
  src/
    PackageSpec.ts     # Schema.Class PackageSpec (name, version). Statics: fromString("zod@3.23.8"),
                       #   normalizeSpecifier (absorbs v3 normalizeModuleName + NODE_BUILTINS).
                       #   Instance: toString, cacheKey. The dead v3 `registry` field is CUT.
    Vfs.ts             # the currency type: Vfs (Map<string, string> keyed by node_modules/-prefixed
                       #   paths) + mergeVfs/prefixVfs helpers. Name follows the package, not v3's
                       #   VirtualFileSystem (kept as a type alias for the consumer migration).
    TypeCache.ts       # the two-plane cache concept. TypeCacheMetadata (Schema.Class, ttl as
                       #   Duration), TypeCacheError, CachePruneResult, TypeCache service +
                       #   layer({cacheDir}) / layerXdg(namespace?) over store Cache + FileSystem/Path.
    PackageFetcher.ts  # the jsDelivr client concept. PackageFetcher service + layer, FetchError,
                       #   PackageNotFoundError, VersionNotFoundError, retry/timeout policy.
    TypeResolver.ts    # PURE statics — no service (v3's Layer.succeed of stateless fns was
                       #   ceremony). ResolvedModule Schema.Class. Option where nothing resolves.
    TypeRegistry.ts    # the facade Context.Service: hasCached, fetchAndCache, getPackageVfs,
                       #   getVfs, resolveImport, getTypeEntries, resolveVersion, clearCache,
                       #   pruneCache. Owns BatchLoadError. layer composes the other services.
    RegistryEvent.ts   # the observer concept: schema-backed RegistryEvent union, RegistryObserver
                       #   Context.Service, layerCallback / layerNoop, internal emit.
    VirtualPackage.ts  # locally-supplied virtual packages: statics create / createMultiEntry /
                       #   fromFile (FileSystem via R), instance toVfs. Subclass-friendly (the
                       #   rspress consumer extends it).
    TsEnvironment.ts   # the @typescript/vfs seam — the ONLY module importing typescript or
                       #   @typescript/vfs. TsEnvironment.make({vfs, compilerOptions, ...}).
    index.ts           # public surface, re-exports only
    internal/
      jsdelivr.ts      # URL builders, response Schema.Structs, fetch helpers
      resolution.ts    # exports-map machinery: getExportValue, substituteWildcard, tryExtensions,
                       #   findMainTypePath, typesVersions wildcards — hardened (see Hardening)
      limits.ts        # MAX_NESTING_DEPTH = 256 and the resolution budget constants
  __test__/
    PackageSpec.test.ts
    TypeCache.test.ts
    PackageFetcher.test.ts
    TypeResolver.test.ts
    TypeRegistry.test.ts
    RegistryEvent.test.ts
    VirtualPackage.test.ts
    TsEnvironment.test.ts
    e2e/jsdelivr.e2e.test.ts   # real-network suite, opt-in
```

Import direction stays a DAG: `PackageSpec.ts` and `Vfs.ts` import nothing local; `TypeCache.ts`/`PackageFetcher.ts` import them; `TypeRegistry.ts` imports the services; `RegistryEvent.ts` is a leaf the others emit into; `TsEnvironment.ts` imports only `Vfs.ts`.

As-built: the layout landed exactly as drawn, with **no `Vfs.test.ts`** — the two helpers are exercised in `VirtualPackage.test.ts`, which is their only real caller. The helpers are named **`mergeVfs` / `prefixVfs`**, not the bare `merge` / `prefix` the draft implied: these are free-standing named exports reached through `index.ts`, and a bare `merge` in a consumer's import list says nothing about what it merges. The package prefix *is* the namespace, which is the same reasoning that keeps the codecs free-standing in config-file.

## Public surface

### PackageSpec

```ts
class PackageSpec extends Schema.Class<PackageSpec>("PackageSpec")({
  name: Schema.String,      // non-empty; npm-name-shaped check, lenient (CDN reality)
  version: Schema.String,   // as requested: exact, range, or dist-tag — pinned later
}) {
  static fromString(spec: string): PackageSpec;        // "zod@3.23.8", "@scope/pkg@^1.0.0"
  static normalizeSpecifier(specifier: string): string; // absorbs normalizeModuleName + NODE_BUILTINS
  toString(): string;                                   // "zod@3.23.8"
  get cacheKey(): string;                               // absorbs keyOf; keyToPackage becomes a static
}
```

Construction via `PackageSpec.make(...)` (never `new` — the v3 README's `new PackageSpec(...)` pattern is part of the consumer migration). The v3 `registry` field is **cut**: it was documented, read by nothing, and the fetcher hardcodes jsDelivr. If a second backend ever appears it arrives as a `PackageFetcher` layer, not a data field (review §5.3 — the service seam is the extension point, kept).

**As-built — the checks are hardening-lenient, and that is the whole design.** Both fields carry a pattern check, but the patterns are scoped to *one* question: could this string, joined into a cache path, escape `<cacheDir>/<name>/<version>/`? So they reject `/`, `\`, whitespace, `@` inside a segment, and the traversal literals `.` and `..`; `name` additionally permits one leading `@scope/`. They also reject **`:`, `?` and `#`**, which the draft's separator-and-traversal framing missed and which are load-bearing for two reasons beyond path escape: `:` is the `cacheKey` scheme's own delimiter, so a name or version containing one breaks the key's round-trip (`parseCacheKey` could re-split a crafted key into a *different* spec), and all three are URL syntax — `?` and `#` in a name would truncate or re-target a jsDelivr request. Path safety, key-codec injectivity and URL safety are three questions; one character class answers all three. They do **not** enforce npm's naming rules — no length cap, no lowercase requirement. This is deliberate and is the same call as [not taking `@effected/package-json`](#tier-and-dependencies): these names come off a CDN carrying every malformation npm ever published, so a validator that is stricter than the path-safety question it exists to answer would reject real packages that resolve fine. Path-escape hostility is pinned in both `PackageSpec.test.ts` and `TypeCache.test.ts`.

Two more as-built specifics:

- **`fromString` defaults a missing version to `"latest"`** rather than failing — `"zod"` is a legitimate specifier and `latest` is a dist-tag `resolveVersion` already resolves. It splits on the *last* `@` so scoped names survive, and throws as a defect on an invalid name (it is a total constructor over a literal, not an IO boundary).
- **`parseCacheKey` returns `Option<PackageSpec>`**, not a raw spec: a cache key is read back off disk, so it is untrusted input, and it re-validates against the same two patterns before constructing. A malformed key is `Option.none()` — a stale or hostile cache entry cannot smuggle a path segment back in through the key codec.
- **`normalizeSpecifier` matches the *first path segment* against the built-in set**, not the whole specifier. A whole-specifier match handles `fs` and misses `fs/promises`, `readline/promises`, `util/types` and every other built-in subpath — each of which would then be fetched from npm as if it were a published package (`readline/promises` resolving to a *third-party* `readline` package is the sharp end of that). Matching the first segment normalizes the entire family to `node` without enumerating it. Scoped specifiers keep the two-segment rule (`@effect/platform/Http` → `@effect/platform`) and `node:` prefixes short-circuit.

### TypeCache — the two-plane cache

The disk-file plane (`FileSystem` from `effect` core) holds the fetched `.d.ts` files under `<cacheDir>/<name>/<version>/`; the metadata plane is **`@effected/store`'s `Cache`** — the very service that was extracted from `xdg-effect` for this purpose. Store's native TTL expiry (evict-on-read, bulk `prune`) is what the v3 stale-vs-miss behavior silently depended on; now the dependency is explicit and pinned by tests.

```ts
class TypeCacheMetadata extends Schema.Class<TypeCacheMetadata>("TypeCacheMetadata")({
  version: Schema.String,
  cachedAt: Schema.DateTimeUtcFromString,             // v3: raw epoch number
  ttl: Schema.optionalKey(Schema.DurationFromMillis), // v3: raw millis; absent = never expires
}) {}

const MetadataFromJson = Schema.fromJsonString(TypeCacheMetadata);   // module-private

interface TypeCacheShape {
  readonly exists: (pkg: PackageSpec) => Effect<boolean, TypeCacheError>;
  readonly read: (pkg: PackageSpec, filePath: string) => Effect<string, TypeCacheError>;
  readonly write: (pkg: PackageSpec, filePath: string, content: string) => Effect<void, TypeCacheError>;
  readonly listFiles: (pkg: PackageSpec) => Effect<ReadonlyArray<string>, TypeCacheError>;
  readonly readMetadata: (pkg: PackageSpec) => Effect<Option<TypeCacheMetadata>, TypeCacheError>;
  readonly writeMetadata: (pkg: PackageSpec, metadata: TypeCacheMetadata) => Effect<void, TypeCacheError>;
  readonly getVfs: (pkg: PackageSpec) => Effect<Vfs, TypeCacheError>;
  readonly remove: (pkg: PackageSpec) => Effect<void, TypeCacheError>;
  readonly prune: Effect<CachePruneResult, TypeCacheError>;
}

class TypeCache extends Context.Service<TypeCache, TypeCacheShape>()("@effected/ts-vfs/TypeCache") {
  static layer(options: { readonly cacheDir: string }):
    Layer<TypeCache, never, Cache | FileSystem | Path>;      // Cache = @effected/store
  static layerXdg(options?: { readonly namespace?: string }): // default "ts-vfs"
    Layer<TypeCache, AppDirsError, Cache | AppDirs | FileSystem | Path>;
}
```

**As-built — `DateTimeUtc` and `Duration` have no JSON encoding on beta.94, and the store plane needs one.** The draft's `Schema.DateTimeUtc` / `Schema.Duration` are `declare` schemas: they describe the runtime type and carry **no transformation to a serializable form**, so encoding a `TypeCacheMetadata` through them for the store's `Uint8Array` value yields nothing usable. The metadata plane is exactly where that bites, because store's `Cache` holds bytes. As-built the two fields use the **`FromString` / `FromMillis` codecs** above, and the whole class round-trips through a module-private `Schema.fromJsonString(TypeCacheMetadata)` against `TextEncoder`/`TextDecoder`. **The type side is unchanged** — `cachedAt` is still a `DateTime.Utc` and `ttl` still a `Duration` in every signature a caller sees; only the encoded representation is pinned. The `Duration`s on the [event channel](#registryevent--the-observer-schema-backed) stay the plain `Schema.Duration`, correctly: events are handed to an in-process callback and are never serialized by this package.

Decisions:

- **Crash-ordering kept verbatim** (review praise): `remove` deletes metadata before files, so a crash leaves harmless orphaned files, never a phantom hit; `prune` is best-effort/non-transactional with the rationale in TSDoc. **As-built, `prune` reports only the directories it actually deleted**: a failed removal is still swallowed (the orphan is harmless — that is the best-effort contract) but it is no longer *claimed* in the result. Best-effort is a statement about what prune tries, never a licence for its report to be fiction; a caller reconciling the returned list against the disk would otherwise find directories prune said it removed still sitting there.
- **`layerXdg` uses `AppDirs.ensureCache`**, which is what discharges store's recorded constraint that the database directory must exist before `SqliteClient.layer` is built ([store as-built note](store.md#the-v4-sqlite-decision)). The wiring that v3 buried in `platforms/node.ts` (`SqliteCache.XdgLive` + `XdgLive(appConfig)`) becomes two documented lines at the consumer edge — this package never builds the store layer itself. **As-built the cache root is `<AppDirs cache>/<namespace>`** (namespace defaulting to `"ts-vfs"`), not the bare `AppDirs` cache directory: `ensureCache` creates the application's cache dir, and the layer then `makeDirectory`s the namespaced subdirectory under it, mapping a failure to **`AppDirsError`** (`directory: "cache"`) so the layer's `E` stays the one xdg error the consumer already handles rather than growing a second. The namespace is validated at layer-construction time — empty, `.`, `..`, or containing a separator is a wiring defect and dies, per the [construction-defect rule](#error-handling).
- **The metadata plane is swappable in tests**: store's `Cache.layerTest` (`:memory:`) satisfies `TypeCache.layer` with no real database file — the seam the review asked to be named (§5.2).
- **The layer statics are parameterized factories** — the [store memoization trap](store.md#the-layer-trio) applies verbatim: bind the built layer to a `const`, or two provide sites mint two caches.
- `cacheKey` codec (v3 `keyOf`/`keyToPackage`) moves onto `PackageSpec`; keys keep the colon scheme so a store database written by v3 is *not* readable — there is no compat contract, nothing is published.

### PackageFetcher — the jsDelivr client

```ts
class PackageFetcher extends Context.Service<PackageFetcher, {
  readonly getVersions: (name: string) => Effect<PackageVersions, FetchError>;
  readonly getFileTree: (pkg: PackageSpec) => Effect<ReadonlyArray<string>, FetchError | PackageNotFoundError>;
  readonly downloadFile: (pkg: PackageSpec, path: string) => Effect<string, FetchError | PackageNotFoundError>;
  readonly getPackageJson: (pkg: PackageSpec) => Effect<PackageManifest, FetchError | PackageNotFoundError>;
  readonly getTypeFiles: (pkg: PackageSpec) => Effect<ReadonlyMap<string, string>, FetchError | PackageNotFoundError>;
}>()("@effected/ts-vfs/PackageFetcher") {
  static readonly layer: Layer<PackageFetcher, never, HttpClient>;
}
```

- **v3's boundary discipline is kept**: fail fast on non-2xx (jsDelivr 404s carry plain-text bodies that would otherwise surface as opaque JSON failures), retry only transport/timeout errors (exponential, 3 recurs), 30s timeout, `FetchFailed` event with status + body snippet.
- **As-built — how "transport error" is actually spelled on beta.94.** The retry predicate is the load-bearing half of that discipline (retrying a 404 is a bug), and v4 does not expose a `TransportError` class to catch. `HttpClientError` is a **single wrapper class** carrying a discriminated `reason` union, so the check is a field test, not a tag test on the error itself:

  ```ts
  const isTransient = (error: unknown): boolean =>
    Cause.isTimeoutError(error) ||
    (HttpClientError.isHttpClientError(error) && error.reason._tag === "TransportError");
  ```

  Both arms are needed: the timeout is imposed by this package's own `Effect.timeout` and arrives as a core `TimeoutError`, never as an `HttpClientError`. A `catchTag("TransportError")` — the shape a v3 habit reaches for — matches nothing here and would silently retry *everything* or *nothing* depending on how the fallback is written. Anything that is not transient (including every non-2xx status) fails on the first attempt.
- **The status is a structured field now.** v3 folded HTTP status into a message string and then substring-matched `"404"` back out of it; `FetchError.status` is `Schema.optionalKey(Schema.Number)` and the 404→`PackageNotFoundError` promotion happens on the typed field.
- `resolveVersion` leaves this service — see next.
- Response validation: `Schema.decodeUnknownEffect` against internal Structs, `SchemaError` normalized to `FetchError` (with the schema failure as structured `cause`) at this boundary per the [error standard](../effect-standards.md#error-handling-standards) — the `ParseError` class (and its name collision with effect's own) is not ported.
- `PackageManifest` is the internal lenient package.json subset (`types`/`typings`/`main`/`exports`/`typesVersions`/dependency maps), exported as a type for `TypeResolver`'s signatures.

**As-built — `exports` accepts Node's fallback arrays, and leniency here is correctness, not laxity.** The draft modeled `exports` as string-or-object. Node's specification also allows an **array** of targets — at the top level (`"exports": ["./index.d.ts", "./index.js"]`) and, far more commonly, as a nested condition's target — with "walk in order, take the first that resolves" semantics. A schema that rejects arrays does not merely under-resolve those packages: it fails the whole manifest decode as a `FetchError` `kind: "schema"`, so a published, valid package becomes an error. `PackageManifest.exports` is therefore `String | Record<String, Unknown> | Array<Unknown>`, `extractTypesFromExport` **walks arrays in order and the first types-bearing entry wins**, and `substituteWildcard` **substitutes inside arrays** as well as objects — a wildcard target that is an array must not lose its capture. The depth guard covers the array recursion like every other surface.

**The materialization budget pre-checks declared sizes, and the backstop counts bytes.** The draft's budget only accounted bodies as they landed — which caps memory *after* paying for the download. The jsDelivr flat-tree response carries a per-file `size`, so `FileTreeResponse` now decodes it (`Schema.optionalKey(Schema.Number)` — optional, because a size the CDN omits must not fail the decode) and `getTypeFiles` **rejects a package whose declared declaration bytes already exceed the cap before issuing a single request**. The declared sizes are still CDN data and may lie, so the post-download accounting stays as the backstop — but it now counts **UTF-8 bytes via `TextEncoder`, not `String.length`**. The draft's implicit `length` check measures UTF-16 code units, which under-counts every non-ASCII byte in a declaration file and lets a hostile package overshoot a *byte* budget by up to 3× while the counter reads as compliant. A budget denominated in bytes must be counted in bytes.

**The error-body read failure is preserved as the `FetchError` cause.** On a non-2xx, the fetcher reads the body for the snippet — and that read can itself fail. Discarding the failure and reporting an empty snippet reports the *status* while silently destroying the evidence of *why* the body was unreadable, which is the exact cause-laundering pattern this port exists to remove. As built, the read's failure becomes the `FetchError`'s structural `cause` rather than an empty string standing in for it.

### resolveVersion goes local

v3 delegated range resolution to jsDelivr's `/resolve` endpoint and detected rejected ranges by substring-matching CDN error prose — the single worst input to `classifyLoadError`. The port resolves locally (review §5.4):

- dist-tags (`latest`, `next`) resolve through `getVersions().tags`;
- exact versions and ranges resolve by matching against `getVersions().versions` with **`@effected/semver`** (`Range.parse` + max-satisfying), which turns the unused v3 `semver-effect` dependency into a used `workspace:*` edge;
- an unmatched ref fails as `VersionNotFoundError` with the requested ref and (bounded) available-version context — typed, no prose parsing;
- the `/resolve` endpoint is dropped.

### TypeRegistry — the facade as a service

The single significant API change, and the one the consumer proved: rspress immediately re-wrapped the v3 floating-function namespace in its own `TypeRegistryService`. The facade becomes that service:

```ts
class TypeRegistry extends Context.Service<TypeRegistry, {
  readonly hasCached: (pkg: PackageSpec) => Effect<boolean, TypeCacheError>;
  readonly fetchAndCache: (pkg: PackageSpec, options?: { readonly ttl?: Duration }) =>
    Effect<void, FetchError | PackageNotFoundError | TypeCacheError>;
  readonly getPackageVfs: (pkg: PackageSpec, options?: PackageVfsOptions) =>
    Effect<Vfs, FetchError | PackageNotFoundError | TypeCacheError>;
  readonly getVfs: (packages: ReadonlyArray<PackageSpec>, options?: PackageVfsOptions) =>
    Effect<Vfs, BatchLoadError>;
  readonly resolveImport: (pkg: PackageSpec, specifier: string) =>
    Effect<Option<ResolvedModule>, TypeCacheError | FetchError>;
  readonly getTypeEntries: (pkg: PackageSpec) =>
    Effect<ReadonlyArray<ResolvedModule>, TypeCacheError | FetchError>;
  readonly resolveVersion: (name: string, ref: string) =>
    Effect<string, FetchError | VersionNotFoundError>;
  readonly clearCache: (pkg: PackageSpec) => Effect<void, TypeCacheError>;
  readonly pruneCache: Effect<CachePruneResult, TypeCacheError>;
}>()("@effected/ts-vfs/TypeRegistry") {
  static readonly layer: Layer<TypeRegistry, never, TypeCache | PackageFetcher>;
}
```

- `yield* TypeRegistry` collapses the v3 `CacheService | PackageFetcher | TypeResolver` requirement union to one service and deletes the consumer's wrapper boilerplate. Per-method error unions stay precise.
- **Batch semantics kept verbatim** (concurrency 5, accumulate, merge partial results, fail only when every package fails) — but the all-failed case raises **`BatchLoadError`** carrying a structured `failures: ReadonlyArray<{ pkg, error }>` list instead of v3's `PackageNotFoundError` with a comma-joined `name` and empty `version`.
- **`classifyLoadError` dies.** The `PackageLoadFailed` event's `kind` is computed from typed error tags and structured fields (`PackageNotFoundError` → `not-found`, `VersionNotFoundError` → `version-range`, `FetchError.status` → `not-found`/`network`, schema cause → `schema`), never from message substrings.
- **Stale-vs-miss kept** (a real feature): live metadata → hit; files on disk + no metadata → stale (refetch when `autoFetch`, serve stale otherwise); nothing → miss (fetch or fail typed on `autoFetch: false`).
- Durations in events come from `Clock` (`Effect.timed`), not `Date.now()`.

**As-built — a hit requires BOTH planes, not just the metadata one.** The draft's ladder read the metadata plane as authoritative: live metadata → hit, full stop. That is a phantom hit whenever the two planes disagree in the *other* direction from the one crash-ordering protects — live metadata whose package directory is missing or empty. The write path cannot produce it (metadata is written last), but an external actor can: a `rm -rf` of the cache dir, a disk-space reaper, another process. The consequence is not a slow path but a wrong one — the hit branch would serve an **empty `Vfs`**, and Twoslash would typecheck the sample against nothing and report phantom errors. So the port checks disk presence *and* metadata liveness, and treats live-metadata-without-files as a **miss** (refetch), not a hit. The two-plane cache now has a two-plane hit rule; the asymmetry in the draft was an oversight, not a design.

**Per-package mutation serialization: a v4 `Semaphore.make(1)` held in the layer**, taken by `fetchAndCache`, `clearCache` and `pruneCache`. Without it, a `clearCache` interleaving between a fetch's file writes and its metadata write strands **live metadata over a deleted directory** — manufacturing in-process exactly the both-planes disagreement above. The semaphore guards fibers **within this runtime only**; cross-process races on a shared cache directory are explicitly **out of scope** (noted in the code, not just here), and the both-planes hit rule is the backstop for anything external. The reads (`hasCached`, `getPackageVfs`) stay unserialized: they are the hot path, and their failure mode under a concurrent mutation is a redundant refetch, not corruption.

**`resolveVersion`'s dist-tag lookup is `Object.hasOwn`-guarded** — the one untrusted read the port had missed. Tags come off the CDN as a JSON object, so `tags[ref]` with `ref = "constructor"` reads an inherited function off the prototype and hands it on as if it were a version string. The rest of the resolution machinery was already uniform on this ([Hardening](#hardening)); this call site had escaped the sweep. Every untrusted map in the package is now read through `Object.hasOwn`, with no exceptions to remember.

### TypeResolver — pure statics, honest signatures

v3's `TypeResolver` was `Layer.succeed` over stateless pure functions with a declared `ResolutionError` that the total implementation could never raise, plus silent fallback guessing. Per the [pure-tier default](../effect-standards.md#services-and-layers-standards) ruling (no service for stateless pure code — the xdg `NativeDirs.resolve` precedent), it becomes a class of pure statics, and the fiction ends both ways:

```ts
class ResolvedModule extends Schema.Class<ResolvedModule>("ResolvedModule")({
  filePath: Schema.String,
  isTypeDefinition: Schema.Boolean,
  package: PackageSpec,
}) {}

class TypeResolver {
  static resolveImport(specifier: string, manifest: PackageManifest, pkg: PackageSpec): Option<ResolvedModule>;
  static resolveMainEntry(manifest: PackageManifest, pkg: PackageSpec): ResolvedModule;   // total: index.d.ts floor
  static resolveTypeEntries(manifest: PackageManifest, pkg: PackageSpec): ReadonlyArray<ResolvedModule>;
  static findTypeDefinition(jsFilePath: string, pkg: PackageSpec): Option<ResolvedModule>; // Option: the path is CDN data
}
```

`resolveImport` returns `Option.none()` where v3 returned a fabricated guess — the caller (Twoslash tooling probing an import) decides the fallback policy. `resolveMainEntry` keeps its documented `index.d.ts` convention floor, which makes it genuinely total. No error class, no service, no layer.

**As-built — the path-safety invariant moved *inside* construction, and it changed one signature.** The draft treated `findTypeDefinition` as "total by construction": a `.js` path in, the conventional `.d.ts` path out. But its input is a **file-tree path from the CDN**, and its output reaches a download URL and the cache's `path.join` — so an absolute or `..`-bearing tree path was one hop from writing outside `<cacheDir>/<name>/<version>/`. The port therefore puts the check where it cannot be forgotten: a module-private `safeResolved(filePath, pkg)` normalizes the path and runs `isSafeRelativePath` **before any `ResolvedModule` is constructed**, so *no* resolver path can produce a `ResolvedModule` that escapes the package. The predicate is shared with `TypeCache` through `internal/resolution.ts` — one invariant, one implementation, both callers.

The signature consequences, each deliberate:

- **`findTypeDefinition(jsFilePath, pkg)` returns `Option<ResolvedModule>`** — it fails closed on a hostile tree path rather than being total over a lie. It also now takes the `pkg` it is resolving within, because a `ResolvedModule` carries its package.
- **`resolveMainEntry` stays total**, and the floor is what pays for it: a hostile `main`/`types` path does not propagate and does not throw — it falls to the documented `index.d.ts` convention floor (`Option.getOrElse` over `safeResolved`). Totality is preserved by the fallback that was already designed in, not by trusting the manifest.
- **`resolveTypeEntries` skips wildcard export keys** (`"./*"`). Enumeration has no captured segment to substitute, so a pattern key would emit a literal `dist/*.d.ts` — a path that names nothing. Pattern subpaths resolve through `resolveImport`, which has the concrete specifier and the capture. Entries whose paths escape the package are skipped rather than failing the enumeration.

### RegistryEvent — the observer, schema-backed

The v3 standout, kept in shape and upgraded in representation: `Data.TaggedEnum` → a `Schema.Union` of `Schema.TaggedStruct`s (the [store `CacheEventPayload` precedent](store.md#cache)), because events cross the library/host boundary and hosts ship them to telemetry — serializable is the standards-aligned default. Consumers keep exhaustive matching (`Schema`-tagged unions match on `_tag`; the rspress `$match` call sites migrate to a plain switch or `Match`).

```ts
const RegistryEvent = Schema.Union([
  Schema.TaggedStruct("VersionResolved", { package, requested, resolved }),
  Schema.TaggedStruct("VersionResolveFailed", { package, requested, kind }),   // "not-found" | "no-match" | "network"
  Schema.TaggedStruct("CacheHit", { package, version, age }),                  // Duration, not ageMinutes
  Schema.TaggedStruct("CacheStale", { package, version }),                     // v3's fake 0/0 fields cut
  Schema.TaggedStruct("CacheMiss", { package, version }),
  Schema.TaggedStruct("FetchStart", { package, version }),
  Schema.TaggedStruct("FetchFailed", { url, status, bodySnippet }),
  Schema.TaggedStruct("PackageLoaded", { package, version, files, source, duration }), // source: "cache" | "network"
  Schema.TaggedStruct("PackageLoadFailed", { package, version, kind, error }), // structured, not message
  Schema.TaggedStruct("BatchStart", { total, packages }),
  Schema.TaggedStruct("BatchComplete", { loaded, failed, total, totalFiles, duration }),
]);

class RegistryObserver extends Context.Service<RegistryObserver, {
  readonly emit: (event: RegistryEvent) => Effect<void>;
}>()("@effected/ts-vfs/RegistryObserver") {
  static layerCallback(onEvent: (event: RegistryEvent) => void): Layer<RegistryObserver>;
  static readonly layerNoop: Layer<RegistryObserver>;
}
```

**As-built — the three typed vocabularies, and the stale-event fix.** The draft said "typed kind, not prose" without saying what the literals are; they are pinned here because a consumer's exhaustive match is written against them:

- `VersionResolveFailed.kind` — **`not-found`** (no such package) | **`no-match`** (the package exists, the range matches no published version) | **`network`**. The first two are precisely the distinction v3 could only recover by substring-matching jsDelivr's error prose.
- `PackageLoadFailed.kind` — **`not-found`** | **`version-range`** | **`schema`** | **`network`** | **`cache`** | **`unknown`**. Two additions to the draft: **`cache`**, because a `TypeCacheError` is a real load-failure mode (the disk plane is unreadable) and folding it into `unknown` would hide the one failure an operator can actually act on; and **`unknown`**, as the honest default arm rather than a lie about a defect.
- `PackageLoaded.source` — **`cache`** | **`network`**.

**`CacheStale` is emitted on *both* stale branches**, and that is a behavioral fix rather than a rename. v3 emitted a fabricated `CacheHit` with `ageMinutes: 0` when it served stale files (`autoFetch: false`), so a host's telemetry counted a stale serve as a fresh hit and its age histogram was poisoned with zeroes. The port emits `CacheStale` whether it goes on to refetch or serves the stale files as-is, and **`PackageLoaded.source` is what distinguishes the two outcomes** — `network` if it refetched, `cache` if it served stale. Staleness and provenance are two facts; v3 conflated them into one field and lost both.

Emission stays **opt-in and zero-cost**: internal sites emit via `Effect.serviceOption(RegistryObserver)` so no requirement is added to any signature and absence is a no-op. The library still performs no `Effect.log` of its own — the host owns presentation (the rspress observer-to-logger bridge is exactly the intended use). The v3 deprecated `events.ts` (`LogEventSchema`) is not ported.

An events-vs-store-events distinction worth recording: store's `Cache` exposes a `PubSub` on the service because its events are intrinsic to an eviction-bearing store; ts-vfs keeps the **observer** posture because its events are progress reporting for a host UI — a push callback with no subscription lifecycle, no `Scope`, usable from non-Effect hosts. Both are deliberate; neither should be "unified" into the other.

### VirtualPackage

Kept nearly as-is (consumer-proven; rspress **subclasses it** — `ApiExtractedPackage extends VirtualPackage` — so it stays an extendable class with a public constructor path). Entries are an in-memory `ReadonlyMap<string, string>`; if `Schema.Class` cannot model that cleanly under the beta, `Data.Class` is the sanctioned fallback per the [error/model standards](../effect-standards.md#error-handling-standards) for in-memory-only shapes — decided at port time with a probe, not assumed.

**As-built: the probe came back clean and the fallback was not needed.** `Schema.ReadonlyMap(Schema.String, Schema.String)` composes inside `Schema.Class` on beta.94, so `VirtualPackage` stays a `Schema.Class` with an `entries: ReadonlyMap<string, string>` field and the `Data.Class` escape hatch stays unspent.

- statics `create(name, version, declarations)`, `createMultiEntry(name, version, entries)`, `fromFile(name, version, path)` (core `FileSystem` via `R`, `PlatformError` surfaced typed);
- instance `toVfs(): Vfs` (rename of `generateVfs`) — synthetic `package.json` with `types` (single entry) or `exports` map (multi-entry), every path `node_modules/<name>/`-prefixed.

**As-built — two silent-empty-package shapes are construction defects.** A `VirtualPackage`'s entries are *developer wiring*, not untrusted input, so the [construction-defect rule](#error-handling) applies and both of these throw rather than producing a package that is quietly wrong:

- **An empty entries map.** It would synthesize a `package.json` whose `types` points at nothing, yielding a package that resolves, typechecks and exports no types — a Twoslash sample failing with "cannot find module" against a package that *is* there. Checked in `createMultiEntry` and again in `toVfs`.
- **Two entries whose names collide after extension normalization.** `toVfs` derives each export key from the entry's file name, so two entries normalizing to the same key mean one silently overwrites the other in the exports map. The last writer wins and the loser vanishes with no diagnostic — precisely the class of bug a virtual filesystem exists to make impossible.

### TsEnvironment — the @typescript/vfs seam

v3's `createTypeScriptCache` was the weakest API in the package: a Promise function on the `/node` entry, plain async/await bypassing Effect, returning a one-entry `Map` keyed by `JSON.stringify(compilerOptions)`. The port keeps the *capability* — it is the package's namesake — and redesigns the surface:

```ts
class TsEnvironment {
  /** Build a VirtualTypeScriptEnvironment over a Vfs (plus the TS lib files). */
  static make(options: {
    readonly vfs: Vfs;
    readonly compilerOptions: ts.CompilerOptions;
    readonly projectRoot?: string;   // v3 hardcoded process.cwd()
  }): Effect<VirtualTypeScriptEnvironment, TsEnvironmentError>;
}
```

- The only module importing `typescript` / `@typescript/vfs`, and it imports them **lazily** — the value imports are dynamic, inside `make`. That, not module isolation alone, is what makes the peers genuinely optional; the reasoning is in [Tier and dependencies](#tier-and-dependencies), and it is the single thing to preserve if this module is ever refactored. A load failure (peer not installed) is caught into a typed `TsEnvironmentError`, so a consumer who skipped the optional peers gets a failure in the error channel at the one call site that needs them, not a crash at import.
- No cache map: the consumer that wants keyed reuse holds its own map (it already does). If a real multi-options cache is ever wanted it becomes a service in a later cycle, designed against a consumer.
- `createDefaultMapFromNodeModules` / `createFSBackedSystem` read the real filesystem through TypeScript's own `sys`, outside `FileSystem` — accepted and documented; this module is why the package is integrated tier on its own surface, not just via R2.
- `VirtualTypeScriptEnvironment` is **not re-exported**: consumers already declare the `@typescript/vfs` peer and import the type from it (the [no-barrel rule](../effect-standards.md#no-barrel-re-exports) — re-exporting a dependency's surface — with the v3 `/node` re-export as the counterexample). As built, the *type* is imported here with `import type`, which erases, so it costs the lazy-import property nothing.

**The open risk is settled — the probe ran, and it found a real bug that v3 was accidentally shielded from.**

`@typescript/vfs@1.6.4` against `typescript@6.0.3` works, and the three functions the design commits to still exist and behave. But `createFSBackedSystem` **does not resolve bare `node_modules/…` map keys**: a `Vfs` is keyed by `node_modules/<name>/…` by construction (that is the whole point of `prefixVfs`), and those keys are simply not found unless they are rooted under `projectRoot`. **v3 never saw this because its real-filesystem fallback shadowed it** — the lookup missed the virtual entry, fell through to the actual `node_modules` on disk, found the package there, and typechecked against *that* instead. It looked correct precisely when the machine happened to have the package installed, which is the failure mode a virtual filesystem exists to eliminate.

So `TsEnvironment.make` **re-roots relative `Vfs` keys under `projectRoot`** (absolute keys pass through untouched) before handing the map to `createFSBackedSystem`, and `projectRoot` defaults to `process.cwd()` — v3 hardcoded it, and it is now the option the draft promised. A test pins the re-rooting directly. This is the finding most likely to bite `app` and the rspress consumer, because the broken shape *passes* on a developer machine.

### What is deliberately NOT ported

- **The `/node` entry and its Promise API.** This monorepo publishes no subpath exports, `runWithNodeLayer` rebuilt the entire layer stack (SQLite open included) on every call, and the standards-preferred posture — consumers compose layers at their edge — is what the rspress plugin already does. The `NodeLayer` composition becomes **documentation**: platform layers + `Store`/`Cache` layers + `TypeCache.layerXdg` + `PackageFetcher.layer` + `TypeRegistry.layer`. **Correcting this row's original guess that it would later become `@effected/app` glue: it did not, and must not.** [@effected/app](app.md#no-effectedts-vfs-edge) shipped with **no `ts-vfs` edge** — taking one would make the composition layer an umbrella over a domain package, the one thing it exists not to be, and ts-vfs consumers compose this stack at their own edge already. What app took from this port is its three wiring *findings*, not its layers.
- **The `Metric` surface** (7 public counters/timers). Store precedent: the app meters its calls; the event channel already carries the counts and durations consumers actually used. Spans replace the manual `Date.now()` bookkeeping.
- **`TimeoutError`** (never constructed), **`ParseError`** (collides with effect's own; `SchemaError` normalization replaces it), **`ResolutionError`** (fictional channel), the **`*Base` export doubling** (12 exports; the inline-factory + `_base` suppression policy replaces it), **`events.ts`** (`@deprecated` in v3), **`PackageSpec.registry`** (read by nothing).
- **`exists()` laundering** — v3 `catchAll`'d cache-existence failures to `false`; the port lets `TypeCacheError` surface.

## Error handling

Six `Schema.TaggedErrorClass` types, each defined in its concept's module, all carrying structural `cause` (`Schema.Defect()`) instead of `message: String(error)`:

| Error | Fields | Raised by | Audience |
| --- | --- | --- | --- |
| `TypeCacheError` | `operation` (literal union), `path`, `cause` | TypeCache disk/metadata ops | calling code, operator |
| `FetchError` | `url`, `status` (`optionalKey`), `kind` (`Literals(["transport", "status", "body", "schema"])`), `cause` | PackageFetcher HTTP/decode | calling code (branch on `status`/`kind`), operator |
| `PackageNotFoundError` | `name`, `version` | fetcher 404 promotion; `getPackageVfs` with `autoFetch: false` | calling code, end user (`message` names the package) |
| `VersionNotFoundError` | `name`, `ref`, `available` (bounded) | local version resolution | calling code, end user |
| `BatchLoadError` | `failures: ReadonlyArray<{ name, version, error }>` | `getVfs` when every package fails | calling code (per-package report), end user |
| `TsEnvironmentError` | `cause` | `TsEnvironment.make` | calling code, operator |

Rulings, per the [error-handling standards](../effect-standards.md#error-handling-standards):

- The v3 pattern of destroying cause structure at the boundary (`String(error)`) and reconstructing classification downstream by substring matching is the headline defect this port removes; every classification consumer (`PackageLoadFailed.kind`, 404 promotion, version-range detection) reads typed fields.
- `SchemaError` from response validation is normalized to `FetchError` (`kind: "schema"`) at the fetch boundary, never leaked.
- Wiring errors are construction defects: a `cacheDir` that is not an absolute path, a nonsensical `ttl` (the [NaN guard](../effect-standards.md#input-hardening-standards) applies to any numeric option), an empty `packages` array is **not** an error (empty `Vfs`, v3 behavior kept).
- A throwing observer callback is a programmer bug and stays a defect — `layerCallback` does not launder it.

## Observability

Named `Effect.fn` spans on every public fallible `TypeRegistry`, `TypeCache` and `PackageFetcher` method, uniform per the house rule (`TypeRegistry.getVfs`, `TypeCache.prune`, `PackageFetcher.getTypeFiles`, ...). `TypeResolver` statics are pure and unspanned. No metrics, no logging, telemetry-agnostic; the `RegistryEvent` channel is the consumer-facing progress surface and carries the `Clock`-derived durations. OTel composition is the application's job.

## Testing

`@effect/vitest`, `it.effect`, `assert.*` — never `expect`; the v3 suites (plain `it` + `Effect.runPromise`) are rewritten, not ported. The real-package fixtures (`zod`, `ts-pattern`, `@effect/schema` manifests and file trees) carry over as data.

**As-built: 82 unit tests across eight suites, plus the one opt-in e2e.** The `Cache.layerTest` seam held — the metadata plane is `:memory:` in every unit test and no real database file is written. The PR #67 review round added the hostile-path suites for the `safeResolved` invariant, the both-planes hit rule, the fallback-array manifests, the declared-size pre-check and the `VirtualPackage` construction defects; every refinement recorded above is pinned by a test.

**The `FileSystem` probe came back negative, and it costs a devDependency.** Effect core on beta.94 ships **no in-memory `FileSystem`** — `FileSystem.layerNoop` is a stub layer, not a working filesystem, so it cannot back a disk plane that actually reads what it wrote. The disk half of the two-plane cache is therefore tested against **real temp directories** with `NodeFileSystem` from **`@effect/platform-node`, taken as a devDependency**. That is a genuine (if small) deviation from the xdg posture of no platform package even in tests, and it is unavoidable rather than a shortcut: xdg's tests could stub `FileSystem` because they assert on *calls*, while these assert on *contents*.

- **TypeCache**: hermetic via store `Cache.layerTest` (`:memory:`) + a real temp dir (see above); TTL expiry and the stale-vs-miss ladder driven by `TestClock.adjust` — live before, stale after, the `autoFetch: false` serve-stale path observed; crash-ordering pinned (metadata gone + files present = stale, not hit); `prune` maps removed keys back to directories.
- **PackageFetcher**: mock `HttpClient` layers (non-2xx plain-text bodies, transport failures vs status failures — retry only the former, observed via `TestClock`), schema-invalid responses land as `FetchError` `kind: "schema"`.
- **TypeRegistry**: batch partial-failure semantics (one of three fails → merged Vfs + `PackageLoadFailed` event; all fail → `BatchLoadError` with three structured failures); event sequence per path (hit/stale/miss) asserted through a recording observer layer; `resolveVersion` dist-tag, range (via semver), and miss paths.
- **TypeResolver**: pure — property tests over exports-map shapes plus the v3 fixture table; the hostile-input suite (below).
- **VirtualPackage / TsEnvironment**: synthetic manifest correctness; `TsEnvironment.make` compiles a Twoslash-sized sample against a fixture Vfs (this is the port's end-to-end proof and the probe for the `@typescript/vfs` risk).
- **e2e**: one opt-in real-jsDelivr suite (`e2e/jsdelivr.e2e.test.ts`) — a single `it.live` that resolves, fetches and rebuilds `zod` off the live CDN through the full layer stack. Gated on the `TS_VFS_E2E` environment variable being **defined** (`describe.skipIf`), so it is skipped in CI and in every default run, and it was run green once by hand. It is the only test that proves the jsDelivr URL shapes are still real; the mock-`HttpClient` suites cannot.

## Hardening

The [input-hardening standards](../effect-standards.md#input-hardening-standards) apply to the resolution machinery — its input is JSON fetched from a CDN, i.e. untrusted:

- **Recursive surfaces, enumerated**: `substituteWildcard` and `extractTypesFromExport` recurse over untrusted `exports` values; `getExportValue` iterates untrusted keys; `listRecursive` walks the (locally-written) cache tree. Each gets the shared `MAX_NESTING_DEPTH = 256` guard from `internal/limits.ts`; overflow on the untrusted surfaces fails typed (`FetchError` `kind: "schema"` at decode, or resolution returning `Option.none()` past the guard — decided per surface at port time, recorded in code).
- **Prototype pollution — a live v3 defect to fix, not just guard**: v3's `substituteWildcard` copies untrusted keys into a plain object literal, so an `exports` map containing a `"__proto__"` key *assigns the prototype* of the result. The port builds substituted maps via `Object.create(null)` or a `Map`, and dunder keys (`__proto__`, `constructor`, `prototype`) in exports/typesVersions maps are skipped.
- **ReDoS**: wildcard patterns from untrusted `exports`/`typesVersions` keys are compiled to regexes (`\*` → `(.*)`). Bound the number of wildcards per pattern (npm semantics use one) and keep `escapeRegex` over the remainder; a pattern exceeding the bound simply does not match. The glob port's CVE history is the precedent for taking this seriously.
- **Materialization budget**: `getTypeFiles` downloads every `.d.ts` a file tree names, concurrency 10. A hostile or pathological package (10⁵ declaration files) must not exhaust memory — cap files-per-package and total bytes with typed failure (`FetchError` `kind: "body"`), the yaml alias-budget lesson applied to downloads. As built the cap is checked **twice**: against the sizes the jsDelivr tree *declares*, before any request is issued, and against the **UTF-8 bytes** that actually land, because the declared sizes are CDN data too (see [PackageFetcher](#packagefetcher--the-jsdelivr-client)).
- **Paths from the CDN are data**: file-tree names join into cache paths — reject absolute paths and `..` segments before any `path.join` (a hostile tree must not write outside `<cacheDir>/<name>/<version>/`). As built this is one predicate, `isSafeRelativePath` in `internal/resolution.ts`, shared by the cache (paths joined under the cache root) and the resolver (paths that reach the download URL). **Manifest paths are data on the same footing as tree paths** — the resolver validates *before* constructing a `ResolvedModule`, which is what turned `findTypeDefinition` into an `Option` ([TypeResolver](#typeresolver--pure-statics-honest-signatures)).
- **Untrusted maps are read only through `Object.hasOwn`** — uniformly, including `resolveVersion`'s dist-tag lookup, where an unguarded `tags[ref]` returns an inherited prototype member for `ref = "constructor"`.

## Build

`savvy.build.ts` carries the standard narrow suppression `{ messageId: "ae-forgotten-export", pattern: "_base" }` for the synthesized bases (the Schema classes, the six error classes, the service classes). Gate: zero-warning `dist/prod/issues.json` via `pnpm build --filter @effected/ts-vfs`, never the raw script. The v3 `*Base` doubling must not reappear — inline factories per the [ratified policy](../effect-standards.md#api-extractor--effect-class-factories).

As-built: the gate is met — **0 warnings, 0 errors, 14 suppressed**, and all 14 are `ae-forgotten-export` on a `*_base` symbol, which is exactly what the one suppression entry is scoped to admit. The v3 `*Base` doubling did not reappear: nothing named `*Base` is exported.

## Consumer migration notes (rspress-plugin-api-extractor)

Every touched surface changes shape; the consumer swap (its own repo, post-`0.1.0`) will need:

| v3 usage | v4 replacement |
| --- | --- |
| `TypeRegistry.*` namespace + own `TypeRegistryService` wrapper | `yield* TypeRegistry` — the wrapper service is deleted |
| `new PackageSpec({...})` | `PackageSpec.make({...})` |
| `NodeLayer` from `/node` | compose at the edge: platform layers + store `Cache.layerSqlite` + `TypeCache.layerXdg` + `PackageFetcher.layer` + `TypeRegistry.layer` |
| `RegistryEvent.$match` | switch/`Match` on `_tag` (schema-tagged union) |
| `TypeRegistryObserver` `Layer.succeed` | `RegistryObserver.layerCallback` |
| `createTypeScriptCache` + one-entry `Map` | `TsEnvironment.make` + its own keyed map |
| `VirtualTypeScriptEnvironment` from `/node` | import from `@typescript/vfs` directly |
| `VirtualPackage.VirtualPackage` namespace access + subclass | direct class import + subclass (kept working) |
| `error.message ?? String(error)` | structured fields on the typed errors |
