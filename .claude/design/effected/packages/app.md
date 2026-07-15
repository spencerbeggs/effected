---
status: current
module: effected
category: architecture
created: 2026-07-12
updated: 2026-07-15
last-synced: 2026-07-15
completeness: 92
related:
  - ../effect-standards.md
  - ../package-inventory.md
  - ../releases.md
  - ../package-setup.md
  - store.md
  - xdg.md
  - config-file.md
---

# @effected/app design

## Overview

`@effected/app` is an **integrated-tier** package by [R2](../effect-standards.md#dependency-policy): the thin composition layer that wires [@effected/xdg](xdg.md), [@effected/config-file](config-file.md) and [@effected/store](store.md) into an **application control plane** — the layer an application composes at its edge to get namespaced directories, a state database, a cache database and a config file, all pointed at the same place, in one call.

It is the home for the composition the underlying ports deliberately parked: xdg's dropped `XdgLive`/`XdgConfigLive`/`XdgFullLive` preset ladder ("the composition they encoded is documentation, and it belongs in `@effected/app`") and store's dropped `SqliteStateXdgLive`/`SqliteCacheXdgLive` glue.

**It owns no domain logic.** It defines no service, no schema and no error class, and it **re-exports nothing** — the [no-barrel rule](../effect-standards.md#no-barrel-re-exports) holds, so a consumer who wants config files alone takes `config-file` alone. The entire public surface is **layer factories, one config preset and one type alias**. If a future change adds a `Context.Service`, that is the signal the change belongs in one of the three packages beneath it instead. Nothing may depend on `@effected/app` — a library taking an application control plane as a dependency would drag tier 3 into its consumers' trees under R2.

## Tier and dependencies

**Integrated tier by [R2](../effect-standards.md#dependency-policy) alone**: `@effected/store` is tier 3 (through `@effect/sql-sqlite-node`) and tier 3 propagates. The package has **zero external runtime dependencies of its own** and does no IO the three packages beneath it do not already do — its tier is inherited, not earned.

- `peerDependencies`: `effect` (`catalog:effect`), `@effected/xdg`, `@effected/store`, `@effected/config-file` (each `workspace:*`).
- `dependencies`: **none.**
- `devDependencies`: the three workspace peers mirrored, plus `@effect/platform-node` for the real-filesystem integration tests.

The three workspace edges are **peers, not regular dependencies**: each appears in this package's public signature types (`AppDirs`/`AppDirsError` from xdg, `Store`/`Cache`/their options and errors from store, `ConfigFileOptions` and the codec/strategy seams from config-file). A second copy of any of them in the consumer's graph would produce two distinct service tags for one concept, and the layer would silently fail to satisfy the requirement — single copies are load-bearing, which is what a peer declares. Direction is acyclic and one-way: app → {xdg, store, config-file}.

## Module layout

```text
packages/app/
  src/
    App.ts         # AppOptions, AppTestOptions, type AppError, App.layer, App.layerTest
    AppStore.ts    # AppStoreOptions, AppStore.layer — the state-dir sqlite Store glue
    AppCache.ts    # AppCacheOptions, AppCache.layer — the cache-dir sqlite Cache glue
    AppConfig.ts   # AppConfigOptions, AppConfig.layer — the xdg-flavored ConfigFile preset
    internal/
      filename.ts  # the single-path-component filename guard
    index.ts       # public surface, re-exports only
```

There is no engine here — nothing but composition and the one wiring-defect guard.

`AppConfig.ts` must stay a **separate module and a free-standing export** from anything that reaches the sqlite driver. This is the [namespace-object / tree-shaking rule](config-file.md#the-load-bearing-constraint-free-standing-named-exports-never-a-namespace-object) applied one level up: `AppConfig` reaches `xdg` + `config-file` only, while `App` / `AppStore` / `AppCache` reach `store` and through it `@effect/sql-sqlite-node`. A consumer who wants XDG-placed config files and no database must be able to import `AppConfig` without pulling a SQLite driver into their graph. Collecting the four concepts into one `App = { … }` namespace object would destroy that silently — **there is no namespace object here either.** Import direction is a DAG: `App.ts` imports `AppStore.ts` + `AppCache.ts` but **not** `AppConfig.ts`, which is what keeps the two graphs separate.

## Public surface

See `src/` for the exact signatures; the load-bearing shapes and decisions:

### AppStore and AppCache — the database glue

Each is a `layer(options)` factory returning `Layer<Store | Cache, …Error, AppDirs | Path.Path>`, built with `Layer.unwrap`: yield `AppDirs`, run `ensure{State,Cache}`, join the directory with a `filename` (default `store.db` / `cache.db`), hand the path to `Store.layerSqlite` / `Cache.layerSqlite`.

**The ensure-before-open ordering is the load-bearing glue — it is the entire reason this package exists.** [store.md](store.md#the-v4-sqlite-decision) records that `SqliteClient.layer` has **no error channel** and **defects** on a missing parent directory: "a package wiring a database path is therefore responsible for ensuring the directory exists *before* the layer is built; nothing downstream can catch it typed." [xdg.md](xdg.md#appdirs--namespace-precedence-creation) supplies the other half: `AppDirs.ensure*` is a `mkdir -p` on a **typed** `AppDirsError` channel. Composing them in that order converts a defect surface into a typed one — "the state directory could not be created" stays on `E`, never `orDie`d (the specific promise v3's `SqliteStateXdgLive` broke).

### App — the control plane

`App.layer(options)` returns `Layer<Xdg | AppDirs | Store | Cache, AppError, FileSystem | Path>`. `AppOptions` extends `AppDirsOptions` (`namespace`, `native`, `fallbackDir`, `dirs`) as **pass-through** — those mean exactly what [xdg.md](xdg.md#appdirs--namespace-precedence-creation) says, including the precedence ladder, and this package re-documents none of it — plus a required `store` and optional `cache`. Composition provides `AppStore` and `AppCache` glue over `AppDirs.layer(options)` + `Xdg.layer`, so all four services come out and only `FileSystem` and `Path` stay in `R` for the consumer's platform layer to supply once, at the edge.

`App.layer` always provides **both** databases. An application that wants only one composes `AppStore.layer` or `AppCache.layer` directly. A conditional-`Cache` flag would either lie in the type or force a second layer type for no gain — but note the consequence honestly: passing no `cache` options **still opens `cache.db`**, because `CacheOptions` are all-optional and absence means defaults, not absence.

### App.layerTest — the hermetic control plane

`App.layerTest(options)` returns the same four services with `R = never`: `Xdg.layerFrom` over a synthetic default `XdgPaths`, `Store.layerTest`/`Cache.layerTest` (`:memory:`), with `Path.layer` and `FileSystem.layerNoop` provided **internally** (satisfied, not exposed). A consumer's first test is one line and needs no platform package. Providing the platform layers internally is the one place this package reaches past a boundary; it is sound because `layerTest` **satisfies** those requirements rather than imposing them, and the layer's `R` is `never` by construction.

The documented limit, stated up front: code paths that actually exercise `ensure*` **die** against `FileSystem.layerNoop` — it is a stub layer, not a working filesystem. `layerTest` is for testing logic that *uses* the control plane; a test of real directory behaviour uses `App.layer` with a temp-directory `HOME`, which is what the integration suite does.

### AppConfig — the xdg-flavored ConfigFile preset

`AppConfig.layer(tag, options)` wraps `ConfigFile.layer` with the resolver chain xdg documents, in xdg's order — `[XdgConfig.resolver({ filename }), XdgConfig.nativeResolver({ namespace, filename })]`, so an existing `~/.config/<app>` still beats the native directory — and with `defaultPath: XdgConfig.savePath(filename)`, which fits config-file's `defaultPath` slot **without an `orDie`** because xdg moved resolution to layer-construction time. The `R` channel is satisfied by `App.layer` sitting beneath it. Three decisions are load-bearing:

- **The namespace is never a parameter.** It is read from the ambient `AppDirs` service at layer build time, so it is typed **exactly once, in `App.layer`**. This kills the two-strings drift where an app passes `"myapp"` to `App.layer` and `"my-app"` to its config preset and reads config from a directory nothing else writes to. Anything derivable is not asked for.
- **The codec stays a required parameter.** Defaulting it, or inferring one from `filename`'s extension, would hard-code a *format* choice into a composition layer — not this package's decision. The caller names `JsonCodec`, `TomlCodec` or their own, and that named import is also what keeps the other three engines out of their bundle.
- **`native` defaults to `true`** — the opposite of `AppDirsOptions.native` (which defaults to `false`). The asymmetry is deliberate: *creating* a native directory commits an application to a location, so it is opt-in; *probing* one for an existing config file costs a `stat` that finds nothing, so it is opt-out. Reading a config a user already put in `~/Library/Application Support` is a courtesy; writing there uninvited is not.

Two implementation notes worth not "helpfully" undoing: the resolver array is annotated `ReadonlyArray<ConfigResolver<AppDirs | Xdg | FileSystem | Path>>` explicitly, because TypeScript would otherwise infer the element type from the first resolver alone and reject the wider requirements of the native resolver; and the tag seam is `Context.Key<Self, ConfigFileShape<A>>` with `AppConfigOptions<A, I>` (no `Self` type parameter — the layer carries it as `AppConfig.layer<Self, A, I>`).

### AppError — the app-edge catch surface

A **type-only** alias unioning the constituent packages' errors (`XdgEnvError`, `AppDirsError`, `StoreError`, `StoreMigrationError`, `CacheError`). It erases, so it costs nothing in the module graph and creates no binding to tree-shake around. It exists so the application edge has a copy-pasteable `catchTags` list; it is a convenience over the constituent errors, not a new error model. Every tag is defined and documented by the package that raises it.

## Errors

**No new error classes.** The constituent errors flow through typed and unwrapped — a `StoreMigrationError` that reaches an application still carries the migration's `id`, `name` and `direction`, and re-wrapping it would destroy exactly the structure the three ports' error redesigns built.

**Wiring defects** per the [input-vs-wiring ruling](../effect-standards.md#error-handling-standards): a `filename` (store's, cache's or config's) dies at layer construction unless it is a single path component. The guard (`internal/filename.ts`) rejects the empty string, anything containing `/` or `\`, and the two traversal names `.` and `..` — the last pair matters because `".."` contains no separator yet still escapes the namespace directory. There are no numeric options of this package's own, so the [NaN guard](../effect-standards.md#input-hardening-standards) has nothing here; pass-through numerics (`CacheOptions.maxEntries`) are guarded by store, which owns them.

## Observability

**No new spans, deliberately.** Every fallible operation inside the glue is already spanned by the package that owns it — `AppDirs.ensure*`, `Store` construction and migrations, every `Cache` method, every `ConfigFile` method. The glue joins paths and composes layers; a span here would wrap another package's span and tell an operator nothing new, so the [ceiling-and-floor rule](../effect-standards.md#observability-standards) is satisfied by construction.

The package stays telemetry-agnostic, but as the **app-edge package** its docs carry the kit's worked example of where OTel goes: `NodeSdk.layer` composed **once, at the top**, beneath the application's own layer stack. Libraries never import `@effect/opentelemetry`; applications do, exactly once.

One caveat this package hands its consumers: the `Cache` it wires stores **byte** values, and Effect's `DateTimeUtc` / `Duration` schemas have no built-in transformation to a serializable form, so anything encoded into a cache value needs the `FromString` / `FromMillis` codecs rather than a bare `declare` schema.

## Memoization

Every export is a **parameterized layer factory**, so [store's layer-memoization trap](store.md#the-layer-trio) applies in full and at maximum cost. Effect memoizes layers **by reference**; each call to `App.layer(…)` builds a new one, and calling a factory inline at two provide sites opens **two databases** — two connections onto one file, two migration ledgers, and two independent `CacheEvent` PubSubs whose subscribers each see half the events. **Bind the result to a `const` once and reuse that binding** — the docs say so at the top of the first example, because this is the package where an application is most likely to compose the same layer in two places.

## Testing

`@effect/vitest`, `it.effect`, `assert.*` — never `expect`; suites in `__test__/`, integration under `__test__/integration/`. `@effect/platform-node` is a devDependency for the real-filesystem integration tests (core ships no working in-memory `FileSystem`). The ordering proofs carry the design's weight — the ensure-before-open ordering is this package's only real claim, and a test that does not watch it fail proves nothing:

- **The databases land in the right directories** — with a temp-directory `HOME`, `store.db` and `cache.db` exist at the joined paths (assert on the file existing, not an echoed option).
- **A fresh namespace with no pre-existing directories builds without a defect** — *the* ensure-before-open proof, watched failing against a naive `Store.layerSqlite(path)`-without-`ensureState` composition, which defects.
- **An unwritable ancestor surfaces a typed `AppDirsError`, never a die** — `Effect.exit` + `Cause.hasFails`/`hasDies` asserting the failure shape; the anti-`orDie` regression aimed at v3's `SqliteStateXdgLive`.
- **`AppConfig` discovers from `$XDG_CONFIG_HOME`** and `save` writes to `XdgConfig.savePath`, end-to-end through the real `ConfigFile.layer`.
- **The namespace-once property** — a config file written by `AppConfig` lands under the namespace passed to `App.layer`, with no namespace passed to `AppConfig` at all. If someone adds a `namespace` option "for flexibility", this should fail.
- **`App.layerTest` works with zero platform layers** — if this ever needs a `NodeFileSystem` import, the layer has stopped doing its job.
- **A bad `filename` dies at construction** — exercised through a shared filename-guard matrix (`__test__/filenameGuard.ts`) registered once per suite against each of the three filename options, including the bare `"."` and `".."` cases a naive "reject separators" guard would pass through.

## Build

`savvy.build.ts` carries **no suppression and needs none**: the package defines no class factories, so there is no synthesized `_base` symbol to suppress and `dist/prod/issues.json` is `errors: 0, warnings: 0, suppressed: 0`. Gate on a cold `pnpm build --filter @effected/app`, never the raw script.

Cross-package `{@link}` references resolve to `ae-unresolved-link` — API Extractor resolves links within the package's own model only, so a link across a package boundary is unresolvable by construction. **The house-safe spelling for a cross-package reference is a plain backticked name**, not `{@link}`. Three workspace peers mean the package needs the `prepare` script (`turbo run build:dev`) so `@effected/xdg`, `@effected/store` and `@effected/config-file` are built at their `dist/dev/pkg` before this package's tests resolve them in a fresh checkout ([package-setup.md](../package-setup.md#cross-package-build-dependencies)).

## Consumer sketch

The end-to-end shape, compressed; the full version belongs in user docs.

```ts
import { Effect, Layer, Schema } from "effect";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { App, AppConfig } from "@effected/app";
import { ConfigFile, JsonCodec } from "@effected/config-file";
import { Store, Cache } from "@effected/store";

class Settings extends Schema.Class<Settings>("Settings")({
  registry: Schema.String,
  concurrency: Schema.Number,
}) {}
class SettingsFile extends ConfigFile.Service<SettingsFile, Settings>()("myapp/Settings") {}

const migrations = [
  { id: 1, name: "runs", up: (sql) => sql`CREATE TABLE runs (id TEXT PRIMARY KEY, at TEXT)` },
];

// Bound once — see Memoization.
const AppLive = App.layer({ namespace: "myapp", store: { migrations }, cache: { maxEntries: 500 } });

const ConfigLive = AppConfig.layer(SettingsFile, {
  filename: "config.json",       // no namespace: it comes from AppLive's AppDirs
  schema: Settings,
  codec: JsonCodec,
});

const MainLive = ConfigLive.pipe(
  Layer.provideMerge(AppLive),
  Layer.provide(NodeServices.layer),   // the one place a platform is named
);

const main = Effect.gen(function* () {
  const settings = yield* (yield* SettingsFile).load;
  const store = yield* Store;
  const cache = yield* Cache;
  yield* store.client`INSERT INTO runs (id, at) VALUES (${crypto.randomUUID()}, datetime())`;
  yield* cache.set({ key: "last-registry", value: new TextEncoder().encode(settings.registry) });
});

NodeRuntime.runMain(main.pipe(Effect.provide(MainLive)));
```

Four services, one platform import, one namespace typed once, and every error in `AppError` on the typed channel.
