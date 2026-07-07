# Review: type-registry-effect → @effected/type-registry

Reviewed: 2026-07-06. Source: `/Users/spencer/workspaces/spencerbeggs/type-registry-effect` (Effect v3, tier: BOUNDARY).
Consumer: `rspress-plugin-api-extractor` (imports `VirtualPackage`, `VirtualFileSystem`, `TypeRegistry` namespace, `PackageSpec`, `RegistryEvent`, `TypeRegistryObserver`, `NodeLayer`, and re-exported `VirtualTypeScriptEnvironment`).

Judged against `.claude/design/effected/effect-standards.md`. v3 idioms are not criticized as such; design observations only.

---

## 1. What is done well (preserve these)

### Observer pattern — the standout abstraction

`TypeRegistryObserver` (src/services/TypeRegistryObserver.ts) is a zero-cost, opt-in typed
event channel resolved via `Effect.serviceOption`:

- Adds **no requirement** to program signatures; no-op when no layer is provided.
- `RegistryEvent` is a `Data.TaggedEnum` with 11 well-chosen variants
  (`CacheHit`, `CacheStale`, `PackageLoadFailed` with a classified `kind`,
  `BatchComplete`, ...) giving consumers `$is`/`$match` for free.
- `layerCallback` is a genuinely low-friction bridge for non-Effect hosts —
  the rspress consumer uses exactly this to drive its progress reporting.
- The library deliberately does **no** `Effect.log` of its own; the host owns
  presentation. This is the right division of responsibility and matches the
  observability standard's library/application split.

This is worth keeping essentially as-is (see §3 for the schema-backed variant question).

### Correct v3 service/layer discipline

- Every service method has `R = never` — platform deps (`FileSystem`, `Path`,
  `HttpClient`, `SqliteCache`, `AppDirs`) are resolved inside layers, never
  leaked into interfaces.
- `makeNodeCacheLayer(baseDir)` vs `CacheServiceLive` (XDG-resolved) is a good
  parameterization seam: tests pin a temp dir, production resolves XDG.
- `TypeRegistryLive = Layer.mergeAll(...)` with platform requirements left
  open, closed only at the edge by `NodeLayer`. This maps 1:1 onto the
  standards' "provide at boundaries" rule.

### Batch semantics and resilience

- `getVFS` loads concurrently (limit 5), accumulates per-package failures,
  merges partial results, and only fails when *every* package fails.
  Best-effort semantics are the right call for the doc-tooling use case and
  are clearly documented.
- `PackageFetcherLive.fetchOk` fails fast on non-2xx (jsDelivr returns
  plain-text error bodies that would otherwise surface as opaque JSON parse
  failures), retries only transport/timeout errors, and emits `FetchFailed`
  with status + body snippet. Thoughtful boundary behavior.

### Cache design

- Two-plane cache: files on disk under `<cacheDir>/<name>/<version>/`,
  metadata in xdg-effect's `SqliteCache` with **native TTL expiry** (expired
  entries evicted on read; `prune` bulk-evicts).
- Crash-ordering is reasoned and documented in code: metadata removed before
  files so a crash leaves harmless orphaned files rather than phantom cache
  hits; prune is deliberately best-effort/non-transactional with the rationale
  written down.
- Stale-vs-miss distinction (files on disk, metadata expired) drives the
  `autoFetch: false` "serve stale" path — a real feature, keep it.

### Other keepers

- `VirtualPackage` — small, consumer-proven abstraction (synthetic
  `package.json` with `types`/`exports` generation from local `.d.ts`
  content). The rspress plugin builds directly on it.
- Metrics: well-named counters + timers with descriptions, consumer-readable
  via `Metric.value` — matches "metrics at meaningful boundaries".
- Dual entry points (`.` platform-agnostic, `./node` platform-closed)
  anticipate the pure/boundary tiering.
- TSDoc coverage is exceptional — every export has remarks + runnable
  examples. Carry this bar forward.
- Tests: properly typed mock layers built from real-package fixtures
  (`zod`, `ts-pattern`, `@effect/schema`), no `as any`; error paths tested.

## 2. What is confusing or awkward

### Kind-based folder sprawl (the standards' explicit target)

`errors/` (6 one-class files), `schemas/` (5), `services/` (4), `layers/` (4),
plus `events.ts`, `metrics.ts`, `platforms/node.ts`. Reading one concept means
three files: interface in `services/CacheService.ts`, tag at the bottom of the
same file, implementation in `layers/CacheServiceLive.ts`, its errors in
`errors/CacheError.ts`. This is exactly the layout the module-per-concept rule
replaces.

### `*Base` export doubling

Every `Data.TaggedClass`/`Data.TaggedError` is split into a named `XBase`
const + the class, **12 extra public exports** existing purely as an
api-extractor workaround for anonymous `_base` symbols. It pollutes the API
surface and the docs. The v4 build pipeline (rslib-builder) must be validated
against `Schema.Class`/`Schema.TaggedErrorClass` extends-clauses early so this
workaround does not get ported.

### Error ladder: advertised 6, real 4, structured 0

- `TimeoutError` is **never constructed** anywhere in src — dead code
  (timeouts get folded into `NetworkError` via `String(error)`).
- `ResolutionError` is declared on all four `TypeResolver` methods but the
  live implementation is total (`Effect.sync`, always returns a fallback
  guess) — the error channel is a fiction.
- All errors carry `message: string` built by `String(error)` — the structured
  cause is destroyed at the boundary. This directly causes the worst hack in
  the codebase: `classifyLoadError` in `TypeRegistry.ts` does **substring
  matching on stringified error messages** ("version range", "404",
  "json parse") to reconstruct classification the type system already had.
  Self-acknowledged as fragile in comments.
- `ParseError` collides with effect's own `ParseResult.ParseError` — a naming
  trap for every consumer that imports both.
- `getVFS`'s all-failed case abuses `PackageNotFoundError` as a batch error:
  `name` = comma-joined package list, `version` = `""`.
- `exists()` declares `CacheError` but internally `catchAll`s to `false` —
  the declared channel never fires.

### Floating functions and misplaced members

- `services/PackageFetcher.ts` mixes the service tag with public constants
  (`JSDELIVR_DATA_API`, `JSDELIVR_CDN`, `TYPE_FILE_PATTERN`), a 50-line
  `NODE_BUILTINS` set, and the floating `normalizeModuleName()` — specifier
  normalization logic that belongs on a spec/specifier concept.
- `TypeRegistry.ts` is a namespace of floating functions
  (`hasCached`, `fetchAndCache`, `getPackageVFS`, ...) each re-yielding the
  services — v3-idiomatic but against the class-based DX target. Telling
  evidence: the rspress consumer immediately **re-wraps this namespace in its
  own `TypeRegistryService`** — the facade wants to be a service.
- `keyOf`/`keyToPackage` (cache key codec) are exported from a layer file.

### Dead / deprecated / redundant surface

- `events.ts` (`LogEventSchema`, all-string annotation schemas) is already
  `@deprecated` in favor of `RegistryEvent` — do not port.
- `semver-effect` is a declared **regular dependency but never imported**
  (mentions only in doc comments). Either remove or actually use it
  (see §5, `resolveVersion`).
- `PackageSpec.registry` field is documented ("alternative registries") but
  used by nothing — the fetcher hardcodes jsDelivr. Ship it or cut it.
- `CacheMetadata` has a parallel handwritten interface + `Schema.Struct`
  const — one logical entity, two definitions.

### The `/node` Promise API

- `runWithNodeLayer` builds the **entire layer stack per call** — every
  `await hasCached(pkg)` re-opens the SQLite store and rebuilds all services.
  Memoization-by-reference doesn't help across `Effect.runPromise` calls; a
  `ManagedRuntime` (or removal) is needed.
- `createTypeScriptCache` returns a `Map<string, VirtualTypeScriptEnvironment>`
  containing exactly **one** entry keyed by `JSON.stringify(compilerOptions)` —
  a "cache" with one item, an API shape only its one consumer could love. It's
  also plain async/await internally, bypassing Effect entirely.
- Manual `Date.now()` duration bookkeeping inside programs duplicates what
  `Metric.trackDuration` / spans already provide.

## 3. v4 migration implications

| v3 construct (this repo) | v4 target (per effect-standards.md) |
| --- | --- |
| `Context.GenericTag<CacheService>("...")` + separate interface (`CacheService`, `PackageFetcher`, `TypeResolver`) | `class X extends Context.Service` — identifier + shape in one place, in the concept's module file |
| `Context.Tag` class (`TypeRegistryObserver`) | same → `Context.Service` |
| `Data.TaggedError("CacheError")` + `*Base` split | `Schema.TaggedErrorClass`, defined in the raising concept's file; `cause: Schema.Defect` field instead of `message: String(error)` |
| `Data.TaggedClass` (`PackageSpec`, `ResolvedModule`) | `Schema.Class` with static/instance methods; construct via `X.make(...)`, never `new X(...)` (README/examples all use `new PackageSpec(...)` today) |
| `Schema.Struct` consts + parallel types (`PackageJson`, `FileTreeResponse`, `CacheMetadata`) | `Schema.Class` for named public models; `Schema.Struct` only for the small internal jsDelivr response shapes |
| `Schema.optional(...)` | `Schema.optionalKey(...)` |
| `Schema.decodeUnknown` at boundaries | `Schema.decodeUnknownEffect`; normalize `SchemaError` to domain errors via `catchTag("SchemaError", ...)` at the fetch boundary — replaces the manual `mapError(... new ParseError(...))` chains |
| `@effect/platform` `FileSystem`/`Path`/`HttpClient` imports | effect core modules (v4 merged platform); `@effect/platform-node` provided by the consumer at the edge — v4 catalog carries no plain `@effect/platform` |
| `@effect/sql` + `@effect/sql-sqlite-node` (declared only to satisfy xdg-effect's optional peers; **never imported in src**) | sql core merges into effect v4; only the driver `@effect/sql-sqlite-node@4` remains a separate package. The whole surface should move behind `@effected/xdg` (`workspace:*`) — this package should declare **no** sql deps of its own |
| `xdg-effect` (`SqliteCache`, `AppDirs`, `XdgLive`) | `@effected/xdg` `workspace:*`; TTL/expiry semantics must be re-verified against the v4 port |
| `semver-effect` (unused) | drop, or use `@effected/semver` for local range resolution (§5) |
| Anonymous `Effect.gen` program bodies | `Effect.fn("TypeRegistry.getPackageVFS")(function* ...)` — named spans; replace manual `Date.now()` timing with span durations + `Metric.trackDuration` |
| `Data.TaggedEnum` `RegistryEvent` | decision point: keep `Data.TaggedEnum` (in-memory only, `$match` DX) or move to a `Schema.Union` of `Schema.TaggedClass` events for serializability. Events cross the library/host boundary and hosts may ship them to telemetry — schema-backed is the standards-aligned default |
| Plain `it()` + `Effect.runPromise` + per-test `Effect.provide` (all 17 test files) | `@effect/vitest` `it.effect`, shared `layer(...)` groups; `TestClock` finally makes the TTL/stale paths properly testable (today they hand-write `cachedAt` timestamps) |
| `LogEventSchema` (deprecated) | delete — redesign is the sanctioned break point |
| `/node` Promise wrappers rebuilding layers per call | if kept, back with a `ManagedRuntime`; standards-preferred: consumers compose layers at their edge (the rspress plugin already does) |

Peer-closure note for v4: `@typescript/vfs` + `typescript` peers exist **only**
for `createTypeScriptCache` — extracting that (see §5) leaves the core package
peering on `effect` (+ optional `@effect/platform-node`) only.

## 4. Candidate module-per-concept layout

```text
src/
  index.ts             # re-exports only
  PackageSpec.ts       # Schema.Class PackageSpec (name, version; brand-checked?).
                       #   Statics: make, fromString("zod@3.23.8"), normalizeSpecifier
                       #   (absorbs normalizeModuleName + NODE_BUILTINS from services/PackageFetcher.ts).
                       #   Instance: toString, cacheKey (absorbs keyOf/keyToPackage as statics).
  PackageJson.ts       # Schema.Class PackageJson (type-resolution subset).
                       #   Candidate delegation to @effected/package-json if scope fits.
  TypeCache.ts         # concept: the disk+sqlite cache (rename of CacheService).
                       #   Schema.Class CacheMetadata (ttl as Duration via transform),
                       #   CachePruneResult, VirtualFileSystem type, CacheError,
                       #   Context.Service TypeCache, layers: layer(baseDir), layerXdg.
  PackageFetcher.ts    # concept: jsDelivr client. Context.Service, layer,
                       #   NetworkError, PackageNotFoundError, FileTree response schemas
                       #   (internal Struct), retry/timeout policy.
  TypeResolver.ts      # concept: package.json → declaration-file resolution.
                       #   Context.Service, Layer.succeed (pure), ResolvedModule Schema.Class,
                       #   ResolutionError (only if the impl actually fails — see §5).
  TypeRegistry.ts      # concept: the facade. Context.Service TypeRegistry with
                       #   hasCached/fetchAndCache/getPackageVFS/getVFS/resolveImport/
                       #   getTypeEntries/resolveVersion/clearCache/pruneCache as methods;
                       #   layer depends on TypeCache | PackageFetcher | TypeResolver.
                       #   Owns BatchLoadError (replaces the PackageNotFoundError abuse).
  RegistryEvent.ts     # concept: the event channel. Event union, Observer
                       #   Context.Service, layerCallback/layerNoop, emit.
  VirtualPackage.ts    # Schema.Class with statics create/createMultiEntry/fromFile,
                       #   instance toVfs (rename of generateVfs).
  internal/
    jsdelivr.ts        # URL builders, fetchOk/fetchJson/fetchText, constants
    resolution.ts      # getExportValue, substituteWildcard, tryExtensions,
                       #   findMainTypePath, wildcard/typesVersions machinery
    metrics.ts         # metric definitions (re-export from TypeRegistry.ts if public)
```

Notes:

- The facade-as-service is the significant API change: `yield* TypeRegistry`
  then `registry.getVFS(...)` collapses `CacheService | PackageFetcher |
  TypeResolver` requirements to one service and deletes the consumer's
  wrapper-service boilerplate. Errors on methods stay precise per-method.
- `TypeRegistryError` union stays, exported from `index.ts`, shrunk to the
  errors actually raised.
- No `node.ts` entry unless the Promise API survives design review; if it
  does, it becomes `src/NodeRuntime.ts` (or similar) backed by a
  `ManagedRuntime`, and `NodeLayer` moves there.

## 5. Extraction / split / seam candidates

1. **TypeScript/Twoslash integration out of core.** `createTypeScriptCache`
   (platforms/node.ts) is the only reason `typescript` and `@typescript/vfs`
   are peers. It is also the weakest API in the package. Options: move into
   the rspress plugin (its only consumer), or a separate concept module /
   sub-export that carries the peers. Removing it makes core's peer closure
   nearly trivial.
2. **Persistence seam: keep the two-plane split, name it.** The disk-file
   plane (`FileSystem`) and metadata plane (`SqliteCache` via `@effected/xdg`)
   are already separable inside `makeCacheService`. Keep `TypeCache` as the
   single public concept, but structure the internals so a test layer can swap
   the metadata plane in-memory without a real SQLite file (today tests must
   construct `SqliteCache` + temp dirs). All sql dependency decisions move to
   `@effected/xdg` — this package should touch sqlite only through that seam.
3. **Registry domain vs CDN client.** `PackageFetcher` is a pure jsDelivr
   client (URLs, flat file tree, resolve endpoint). Keeping it a distinct
   service (not folded into TypeRegistry) preserves the option of alternative
   backends — which is also the honest fate of the unused
   `PackageSpec.registry` field: either the fetcher becomes
   registry-parameterized, or the field is cut.
4. **`resolveVersion` and `@effected/semver`.** Today version resolution is
   delegated to jsDelivr's resolve endpoint, and rejected ranges are detected
   by substring-matching CDN error prose. Using `@effected/semver` to match
   ranges locally against `getVersions` output removes the fragile
   `classifyLoadError` text matching for the version-range case and gives the
   unused-dependency story a real ending (dep becomes `workspace:*`, or is
   dropped along with the endpoint approach — decide at design time).
5. **Exports-map resolution logic.** The `internal/resolution.ts` machinery
   (exports conditions, `typesVersions` wildcards, extension probing) is
   generic package.json-types logic. If `@effected/package-json` grows a
   resolution story, delegate; otherwise keep internal — do not export
   floating helpers.
6. **`TypeResolver` honesty decision.** Either the resolver may fail
   (`ResolutionError` when nothing plausible is found, instead of returning a
   guessed fallback path) or it is total and the error is removed. The current
   "declared error, infallible implementation, silent guessing" is the worst
   of both.

## 6. Peer / dependency hygiene

Current state (v3):

| Declaration | Package | Assessment |
| --- | --- | --- |
| dependencies | `@effect/sql`, `@effect/sql-sqlite-node` | Never imported in src — exist solely to satisfy `xdg-effect`'s **optional** peers. Deliberate closure move (consistent with the peer-closure discipline), but invisible: nothing documents why they're there, and they drag the `better-sqlite3` native build into every consumer install. In v4: delete; the edge belongs to `@effected/xdg`. |
| dependencies | `semver-effect` | **Unused.** Remove or promote to a real usage (§5.4). |
| dependencies | `xdg-effect` | Real. Its non-optional peers (`effect`, `@effect/platform`) are satisfied by this package's own peers ✓; optional peers satisfied by the sql deps above ✓. Closure is actually complete — the hygiene problem is legibility, not correctness. Becomes `@effected/xdg` `workspace:*`. |
| peers | `effect`, `@effect/platform` | Correct for v3. v4: `effect` only (platform merged). |
| peers (optional) | `@effect/platform-node` | Correct — only `./node` needs it. |
| peers (optional) | `typescript`, `@typescript/vfs` | Only for `createTypeScriptCache`; leave with the extraction (§5.1). |
| devDependencies | `@effect/cluster`, `@effect/rpc` | No imports anywhere in src or tests — likely stale peer-satisfaction leftovers for `@effect/sql` v3. Do not carry forward. |

Target closure for `@effected/type-registry` (boundary tier):

- peers: `effect` (+ optional `@effect/platform-node` if a Node convenience
  layer survives; optional `typescript`/`@typescript/vfs` only if the TS-env
  module stays).
- deps: `@effected/xdg` `workspace:*` (+ `@effected/semver` `workspace:*` if
  adopted; peer-vs-regular decided per edge at design time per standards).
- Whatever non-optional peers `@effected/xdg` v4 declares must be re-declared
  here — verify at migration time, don't assume the v3 shape.

---

## Migration risk notes

- The rspress consumer touches: `VirtualPackage`, `VirtualFileSystem`,
  `TypeRegistry.*`, `PackageSpec` (via `new`), `RegistryEvent`,
  `TypeRegistryObserver`, `NodeLayer`, `VirtualTypeScriptEnvironment`
  re-export. Every one of these changes shape under the redesign
  (`.make` vs `new`, facade-as-service, `/node` fate) — plan the consumer
  migration in the same design doc.
- Validate the v4 build pipeline against `Schema.Class` /
  `Schema.TaggedErrorClass` declaration emit **before** porting, or the
  `*Base` workaround will reappear.
- TTL semantics live in `xdg-effect`'s SqliteCache (expiry-on-read, prune);
  the stale-vs-miss behavior of `getPackageVFS` silently depends on them.
  Pin these behaviors with `it.effect` + `TestClock` tests during the port.
