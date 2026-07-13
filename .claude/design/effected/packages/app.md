---
status: current
module: effected
category: architecture
created: 2026-07-12
updated: 2026-07-12
last-synced: 2026-07-12
completeness: 92
related:
  - ../effect-standards.md
  - ../migration-playbook.md
  - ../package-inventory.md
  - ../releases.md
  - ../package-setup.md
  - store.md
  - xdg.md
  - config-file.md
  - ts-vfs.md
---

# @effected/app design

## Overview

**Merged** (2026-07-12, PR #73) with every gate green. Per the semver/jsonc precedent this doc records the *as-built* design, with deviations from the approved draft noted inline as "As-built:". The port landed the design **without structural deviation** — which is what a composition package should do, since it had three merged packages to compose rather than an engine to discover.

`@effected/app` is the **final** package of the migration program (step 2 of [migration-playbook.md](../migration-playbook.md)) and an **integrated-tier** package by [R2](../effect-standards.md#dependency-policy). It is the thin composition layer that wires [@effected/xdg](xdg.md), [@effected/config-file](config-file.md) and [@effected/store](store.md) into an **application control plane**: the layer an application composes at its edge to get namespaced directories, a state database, a cache database and a config file, all pointed at the same place, in one call.

It is **greenfield** — there is no v3 source repo and no migration-table row. But it is not inventing a shape: it is the honest successor to the v3 glue the earlier migrations *deliberately parked*.

- `xdg-effect`'s `XdgLive` / `XdgConfigLive` / `XdgFullLive` preset ladder — dropped at the xdg port with the reason recorded in [xdg.md](xdg.md#what-is-deliberately-not-ported): "the composition they encoded is documentation, and it belongs in `@effected/app`."
- `xdg-effect`'s `SqliteStateXdgLive` / `SqliteCacheXdgLive` — dropped at the store port, which states plainly that "they reappear as glue in `@effected/app`" ([store.md](store.md#overview)).

Renamed from `@effected/app-kit` before any code existed, per [the app rename](../package-inventory.md#the-app-rename) (2026-07-12): "the kit" already names the whole seventeen-package release, and this package is emphatically **not an umbrella over it**.

**It owns no domain logic.** It defines no service, no schema and no error class, and it **re-exports nothing** — the [no-barrel rule](../effect-standards.md#no-barrel-re-exports) holds, so a consumer who wants config files alone takes `config-file` alone. The entire public surface is **layer factories, one config preset and one type alias**. If a future change to this package adds a `Context.Service`, that is the signal the change belongs in one of the three packages beneath it instead.

## Tier and dependencies

**Integrated tier**, and by [R2](../effect-standards.md#dependency-policy) alone: `@effected/store` is tier 3 (through `@effect/sql-sqlite-node`) and tier 3 propagates. The package has **zero external runtime dependencies of its own** and does no IO the three packages beneath it do not already do. Its tier is inherited, not earned.

- `peerDependencies`: `effect` (`catalog:effect`), `@effected/xdg`, `@effected/store`, `@effected/config-file` (each `workspace:*`).
- `dependencies`: **none**.
- `devDependencies`: the three workspace peers mirrored (the `@effected/walker` precedent, now the house convention — see [config-file.md](config-file.md#tier-and-dependencies)), plus `@effect/platform-node` for the real-filesystem integration tests, and the standard build/test set.

All three workspace edges are **peers, not regular dependencies**, for the reason the xdg review gave and xdg's own config-file edge already follows: **each appears in this package's public signature types** — `AppDirs` and `AppDirsError` from xdg, `Store` / `Cache` / `StoreOptions` / `CacheOptions` and their errors from store, `ConfigFileOptions` and the codec/strategy seams from config-file. A second copy of any of them in the consumer's graph would produce two distinct service tags for one concept, and the layer would silently fail to satisfy the requirement. Single copies are load-bearing here, which is exactly what a peer declares.

Direction is acyclic and one-way: app → {xdg, store, config-file}. **Nothing may depend on `@effected/app`** — a library taking an application control plane as a dependency would drag tier 3 into its consumers' trees under R2, which is the leak the whole taxonomy exists to prevent. This is also why no consumer is blocked on this package and why it could be sequenced last ([releases.md](../releases.md#the-gate)).

### No `@effected/ts-vfs` edge

The [ts-vfs](ts-vfs.md) `NodeLayer` stack — platform layers, store's `Cache`, `TypeCache.layerXdg`, `PackageFetcher.layer` and `TypeRegistry.layer` — is the concrete wiring specimen this package was sequenced last to absorb ([migration order](../package-inventory.md#migration-order)). It lands here as a **documentation specimen only**. Adding a `ts-vfs` dependency would make `app` an umbrella over a domain package, which is the one thing it must not be; and ts-vfs consumers compose that stack at their own edge already.

What *is* carried across from that port is its three findings, because they are facts about wiring and this is the wiring package ([ts-vfs.md](ts-vfs.md#overview) names all three as owed to `app`):

- **The lazy compiler import** is what makes ts-vfs's `typescript` / `@typescript/vfs` peers genuinely optional. Module isolation lets a bundler drop `TsEnvironment`; the dynamic import is what keeps the *unbundled* Node consumer alive. Both are load-bearing; neither substitutes for the other. Any future optional-peer glue in this package obeys the same rule.
- **The `createFSBackedSystem` rooting rule.** A `Vfs` keyed by bare `node_modules/…` paths is not found unless it is rooted under `projectRoot`; v3 never saw this because its real-filesystem fallback shadowed the miss. The broken shape *passes on a developer machine* — the failure mode a virtual filesystem exists to eliminate. Worth knowing before writing any example that wires ts-vfs.
- **The `DateTimeUtc` / `Duration` JSON-encoding gap** on beta.94: both are `declare` schemas with no transformation to a serializable form, so anything encoded into store's `Uint8Array` cache values needs the `FromString` / `FromMillis` codecs instead. This package hands consumers a `Cache` whose values are bytes, so the trap is one import away from every consumer of it.

## Module layout (module-per-concept)

```text
packages/app/
  src/
    App.ts         # AppOptions, AppTestOptions, type AppError, App.layer, App.layerTest
    AppStore.ts    # AppStoreOptions, AppStore.layer — the state-dir sqlite Store glue
    AppCache.ts    # AppCacheOptions, AppCache.layer — the cache-dir sqlite Cache glue
    AppConfig.ts   # AppConfigOptions, AppConfig.layer — the xdg-flavored ConfigFile preset
    index.ts       # public surface, re-exports only
  __test__/
    App.test.ts
    AppStore.test.ts
    AppCache.test.ts
    AppConfig.test.ts
    integration/
      App.int.test.ts
```

**No `internal/`.** There is no engine here — there is nothing but composition.

`AppConfig.ts` must stay a **separate module, and a free-standing export**, from anything that reaches the sqlite driver. This is the [namespace-object / tree-shaking rule](config-file.md#the-load-bearing-constraint-distinct-named-exports-never-a-namespace-object) applied one level up: `AppConfig` reaches `xdg` + `config-file` only, while `App` / `AppStore` / `AppCache` reach `store` and through it `@effect/sql-sqlite-node`. A consumer who wants XDG-placed config files and no database must be able to import `AppConfig` without pulling a SQLite driver into their graph. Collecting the four concepts into one `App = { … }` namespace object would destroy that silently — the exact failure config-file measured at 506 bytes versus 129.4 kB — so **there is no namespace object here either**.

Import direction is a DAG: `AppStore.ts` → nothing local; `AppCache.ts` → nothing local; `AppConfig.ts` → nothing local; `App.ts` → `AppStore.ts` + `AppCache.ts`. `App.ts` does **not** import `AppConfig.ts` — that is what keeps the two graphs separate.

## Public surface

### AppStore — the state-directory database

```ts
export interface AppStoreOptions extends StoreOptions {
  /** File name within the app's state directory. Default "store.db". */
  readonly filename?: string;
}

export const AppStore: {
  layer(options: AppStoreOptions):
    Layer<Store, AppDirsError | StoreError | StoreMigrationError, AppDirs | Path.Path>;
};
```

Built with `Layer.unwrap` (verified present on `effect@4.0.0-beta.97`): yield `AppDirs`, run `yield* appDirs.ensureState`, `path.join(stateDir, filename)`, hand the result to `Store.layerSqlite`.

**The ensure-before-open ordering is the load-bearing glue — it is the entire reason this package exists.** [store.md](store.md#the-v4-sqlite-decision) records the as-built fact that `SqliteClient.layer` **has no error channel** and **defects** on a missing parent directory, and concludes: "A package wiring a database path is therefore responsible for ensuring the directory exists *before* the layer is built; nothing downstream can catch it typed." [xdg.md](xdg.md#appdirs--namespace-precedence-creation) supplies the other half: `AppDirs.ensure*` is a `mkdir -p` on a **typed** `AppDirsError` channel. Composing them in that order converts a defect surface into a typed one.

This is also the honest successor to v3's `SqliteStateXdgLive`, which composed the same two things and then **`orDie`d the `AppDirsError`** to advertise a `never` channel. xdg's error-handling section calls that out by name — "Nothing is `orDie`d" — and this layer keeps the promise: "the state directory could not be created" is an expected, recoverable boundary failure, and it stays on `E`.

### AppCache — the cache-directory database

```ts
export interface AppCacheOptions extends CacheOptions {
  /** File name within the app's cache directory. Default "cache.db". */
  readonly filename?: string;
}

export const AppCache: {
  layer(options?: AppCacheOptions):
    Layer<Cache, AppDirsError | CacheError, AppDirs | Path.Path>;
};
```

The same shape over `ensureCache` → `Cache.layerSqlite`. `options` is optional because every `CacheOptions` field is; the semantics are otherwise identical, including the ensure-before-open ordering, which matters *more* here because a cache directory is the one an operator is most likely to have deleted between runs.

### App — the control plane

```ts
export interface AppOptions extends AppDirsOptions {   // namespace, native?, fallbackDir?, dirs?
  readonly store: AppStoreOptions;
  readonly cache?: AppCacheOptions;
}

export const App: {
  layer(options: AppOptions):
    Layer<Xdg | AppDirs | Store | Cache, AppError, FileSystem.FileSystem | Path.Path>;

  layerTest(options: AppTestOptions):
    Layer<Xdg | AppDirs | Store | Cache, AppError>;
};
```

`AppOptions` is `AppDirsOptions` **pass-through** — `namespace`, `native`, `fallbackDir`, `dirs` mean exactly what [xdg.md](xdg.md#appdirs--namespace-precedence-creation) says they mean, including the five-level precedence ladder, and this package re-documents none of it. Composition is `AppDirs.layer(options)` `provideMerge` `Xdg.layer`, with the `AppStore` and `AppCache` glue `provideMerge`d over the result, so all four services come out and only `FileSystem` and `Path` stay in `R` — the two the consumer's platform layer supplies once, at the edge.

**Ruled: `App.layer` always provides both databases.** An application that wants only one composes `AppStore.layer` or `AppCache.layer` directly and never opens the other file. The alternative — a flag that makes `Cache` conditionally present — would either lie in the type (`Cache` in the output when it may not be there) or force a second layer type, and it buys nothing a direct composition does not already give. Note the consequence honestly: passing no `cache` options **still opens `cache.db`**, because `CacheOptions` are all-optional and absence means defaults, not absence.

### App.layerTest — the hermetic control plane

```ts
export interface AppTestOptions {
  readonly namespace: string;
  /** Pin real XDG paths; defaults to a synthetic set under a fake home. */
  readonly paths?: XdgPaths;
  readonly store?: StoreOptions;
  readonly cache?: CacheOptions;
}
```

`Xdg.layerFrom` over a synthetic default `XdgPaths`, `Store.layerTest` / `Cache.layerTest` (`:memory:`), with `Path.layer` and `FileSystem.layerNoop` provided **internally** via `Layer.provide` — not merged into the output, not exposed. The result is that a consumer's first test is **one line and needs no platform package at all**:

```ts
layer(App.layerTest({ namespace: "myapp" }))("app", (it) => {
  it.effect("stores state", () => Effect.gen(function* () { /* Store and Cache are here */ }));
});
```

Providing the platform layers *internally* is deliberate and is the one place this package reaches past a boundary. It is sound because `layerTest` **satisfies** those requirements rather than imposing them: nothing escapes into the consumer's graph, and the layer's `R` is `never` by construction rather than by an `any` cast.

**The documented limit, stated up front so nobody discovers it in a debugger:** code paths that actually exercise `ensure*` **die** against `FileSystem.layerNoop` — it is a stub layer, not a working filesystem ([ts-vfs.md](ts-vfs.md) established this when its own `FileSystem` probe came back negative). `layerTest` is for testing logic that *uses* the control plane. A test of real directory behaviour uses `App.layer` with a temp-directory `HOME`, which is what the integration suite does.

### AppConfig — the xdg-flavored ConfigFile preset

```ts
export interface AppConfigOptions<A, I> {
  readonly filename: string;
  readonly schema: Schema.Codec<A, I>;
  readonly codec: ConfigCodec;                       // required — never inferred, never defaulted
  readonly strategy?: MergeStrategy<A>;              // default MergeStrategy.firstMatch
  readonly validate?: ConfigFileOptions<A>["validate"];
  readonly events?: ConfigFileOptions<A>["events"];
  readonly native?: boolean;                         // default TRUE — see below
}

export const AppConfig: {
  layer<Self, A, I>(tag: Context.Key<Self, ConfigFileShape<A>>, options: AppConfigOptions<A, I>):
    Layer<Self, never, FileSystem.FileSystem | Path.Path | AppDirs | Xdg>;
};
```

It wraps `ConfigFile.layer(tag, …)` with the resolver chain xdg documents and in xdg's documented order — `[XdgConfig.resolver({ filename }), XdgConfig.nativeResolver({ namespace, filename })]`, so an existing `~/.config/<app>` still beats the native directory — and with `defaultPath: XdgConfig.savePath(filename)`, which fits config-file's `defaultPath?: Effect<string, never, RR>` slot **without an `orDie`** precisely because xdg moved resolution to layer-construction time ([xdg.md](xdg.md#as-built-2026-07-11), finding 3). The `R` channel is satisfied by `App.layer` sitting beneath it.

**The namespace is never a parameter.** It is read from the ambient `AppDirs` service at layer build time — `AppDirsShape` carries `namespace` — so it is typed **exactly once, in `App.layer`**. This is the approved DX ruling and it kills a real hazard: the two-strings drift where an app passes `"myapp"` to `App.layer` and `"my-app"` to its config preset, and then reads config from a directory nothing else in the process ever writes to. Anything that can be derived is not asked for.

**The codec stays a required parameter.** Defaulting it, or inferring one from `filename`'s extension, would hard-code a *format* choice into a composition layer — the exact sin `XdgFullLive` was killed for ([xdg.md](xdg.md#what-is-deliberately-not-ported): "the preset factories additionally hard-coded a *format* choice, which after the config-file family split is not xdg's decision to make"). It is not `app`'s decision either. The caller names `JsonCodec`, `TomlCodec` or whatever they wrote, and that named import is also what keeps the other three engines out of their bundle.

**As-built — `native` defaults to `true`.** The native resolver is in the chain unless the caller passes `native: false`, which drops it. This is the opposite default from `AppDirsOptions.native` (which defaults to `false`, per [xdg.md](xdg.md#appdirs--namespace-precedence-creation)), and the asymmetry is deliberate rather than an oversight: *creating* a native directory commits an application to a location, so it is opt-in; *probing* one for an existing config file costs a `stat` that finds nothing, so it is opt-out. Reading a config a user already put in `~/Library/Application Support` is a courtesy; writing there uninvited is not. Two tests pin the default in both directions.

**As-built — the resolver array is annotated up front.** TypeScript infers a `ReadonlyArray`'s element type from its **first** element, so the two-resolver chain would otherwise infer `RR` from `XdgConfig.resolver` alone and reject `nativeResolver`'s wider requirements. The chain is therefore declared `ReadonlyArray<ConfigResolver<AppDirs | Xdg | FileSystem.FileSystem | Path.Path>>` explicitly. An implementation detail with no bearing on the public signature — recorded because it looks like a redundant annotation and is not, so nobody helpfully deletes it.

**As-built — the tag seam has no covariance trap.** The design flagged `Context.Key<Self, ConfigFileShape<A>>` as the spelling most likely to move at port time, given the covariant-`Shape` finding that sank a type-level idea in [config-file.md](config-file.md#error-redesign). Probed: it holds as written. The one change is that `AppConfigOptions`' `Self` type parameter was **unused** and is dropped — it is `AppConfigOptions<A, I>`, while the layer stays `AppConfig.layer<Self, A, I>(tag, options)`.

### AppError — the app-edge catch surface

```ts
export type AppError =
  | XdgEnvError
  | AppDirsError
  | StoreError
  | StoreMigrationError
  | CacheError;
```

A **type-only** alias — it erases, so it costs nothing in the module graph and creates no runtime binding to tree-shake around. It exists for one reason: at the application edge somebody has to write the `catchTags` block, and this is the copy-pasteable list of what can come out of the control plane. It is a *convenience over the constituent packages' errors*, not a new error model; every tag in it is defined and documented by the package that raises it.

### DX decisions, recorded so they are not re-litigated

- **`AppConfig.options` (an options-preset form) was considered and superseded.** The earlier shape returned an options *record* the consumer then passed to `ConfigFile.layer` themselves — two imports, two calls, and one more place for the requirements to be mis-stated. The layer-returning form above is one import and one call, and it is what lets the namespace be read from ambient `AppDirs` rather than threaded by hand.
- **Two upstream DX items are queued, not folded in here.** First, store's `StoreMigration.up` and `.down` were loosened to `Effect<unknown, SqlError>` **as part of this port** — see [store.md](store.md#store) — so a consumer passes a tagged SQL template directly instead of piping `Effect.asVoid` onto it. Second, config-file's schema-on-the-class Service inference — taking the schema on the class factory rather than repeating it in the layer options, which removes the `typeof X.Type` ceremony — is a **deferred** candidate for its own small cycle; see [config-file.md](config-file.md#deferred-dx-candidate-schema-on-the-class-service-inference). If it lands, `AppConfigOptions.schema` becomes redundant and this preset shrinks; the design above does not depend on it either way.

## Errors

**No new error classes.** The constituent errors flow through typed and unwrapped, which is the whole point of `AppError` being an alias rather than a wrapper — a `StoreMigrationError` that reaches an application still carries the migration's `id`, `name` and `direction`, and re-wrapping it into an `AppError` class would destroy exactly the structure the three ports spent their error redesigns building.

**Wiring defects**, per the house [input-vs-wiring ruling](../effect-standards.md#error-handling-standards): a `filename` — store's, cache's or config's — dies at layer construction unless it is **a single path component**. As-built the guard rejects the empty string, anything containing `/` or `\`, and the two traversal names `.` and `..` — the last pair being the case the draft's "empty or contains a separator" phrasing missed, since `filename: ".."` contains no separator and still escapes the namespace directory. It can only come from code, and this is the same escape xdg guards against on `namespace`, for the same reason. There are **no numeric options** of this package's own, so the [NaN guard](../effect-standards.md#input-hardening-standards) has nothing to apply to here; the numeric options that pass through (`CacheOptions.maxEntries`) are guarded by store, which owns them.

## Observability

**No new spans, deliberately.** Every fallible operation inside the glue is *already* spanned by the package that owns it: `AppDirs.ensure*` (xdg), `Store` construction and migrations and every `Cache` method (store), every `ConfigFile` method (config-file). The glue itself adds no unspanned fallible operation — it joins paths and composes layers — so a span here would be a span around another package's span, telling an operator nothing they cannot already see, and the [ceiling-and-floor rule](../effect-standards.md#observability-standards) is satisfied by construction.

The package stays telemetry-agnostic like every other package in the kit. But because this is the **app-edge package**, its docs carry the kit's worked example of *where OTel actually goes*: `NodeSdk.layer` composed **once, at the top**, beneath the application's own layer stack. Libraries never import `@effect/opentelemetry`; applications do, exactly once. That example has had no natural home until now, which is itself a small argument for this package existing.

## Memoization

Every export here is a **parameterized layer factory**, so [store.md's layer-static memoization trap](store.md#the-layer-trio) applies **in full and at maximum cost** — store recorded it partly *because* of this package. Effect memoizes layers **by reference**; each call to `App.layer(…)` builds a new one. Calling a factory inline at two provide sites opens **two databases**: two connections onto one file, two migration ledgers, and two independent `CacheEvent` PubSubs whose subscribers each see half the events.

**Bind the result to a `const` once and reuse that binding.** The docs for this package say so at the top of the first example, not in a footnote, because this is the package where an application is most likely to compose the same layer in two places.

```ts
const AppLive = App.layer({ namespace: "myapp", store: { migrations } });  // once
```

## Testing

`@effect/vitest`, `it.effect`, `assert.*` — never `expect`; suites in `__test__/`, integration under `__test__/integration/*.int.test.ts`. `@effect/platform-node` is a devDependency for the real-filesystem integration tests, following the [config-file precedent](config-file.md#testing-strategy) and the ts-vfs finding that core ships no working in-memory `FileSystem`.

**As-built: every item on the list below shipped** (unit suites plus a real-filesystem integration suite), including the two that carry the design's weight — the **anti-`orDie` test** (an unwritable ancestor surfaces a typed `AppDirsError` and never a die — the regression test aimed at v3's `SqliteStateXdgLive`) and the **fresh-namespace control** (no pre-existing directories, no defect — the ensure-before-open proof).

The filename guard is exercised through a shared **five-case matrix** (`__test__/filenameGuard.ts`), registered once per suite against each of the three filename options. It grew a case in PR review: the bare `"."` — which, like `".."`, contains no path separator and still resolves outside the intended file. A guard written as "reject separators" passes a `"."` straight through, so the matrix is what keeps the [wiring-defect ruling](#errors) honest rather than approximately honest.

Required coverage, the ordering proofs first — because the ensure-before-open ordering is this package's only real claim, and a test that does not watch it fail proves nothing:

- **The databases land in the right directories.** With a temp-directory `HOME` (`FileSystem.makeTempDirectory`), `store.db` exists at the joined state path and `cache.db` at the joined cache path. Assert on the **file existing at the path**, not on an option being echoed back.
- **A fresh namespace with no pre-existing directories builds without a defect.** This is *the* ensure-before-open proof, and it must be watched failing against a naive `Store.layerSqlite(path)`-without-`ensureState` composition, which defects. It is the difference between this package and a two-line snippet in a README.
- **An unwritable ancestor surfaces a typed `AppDirsError`, never a die** — `Effect.exit` plus `Cause.hasFails` / `hasDies`, asserting the *shape* of the failure and not merely that something went wrong. This is the anti-`orDie` regression test, aimed squarely at v3's `SqliteStateXdgLive`.
- **`AppConfig` discovers from `$XDG_CONFIG_HOME`** and `save` writes to `XdgConfig.savePath` — end-to-end through the real `ConfigFile.layer`, not a unit test of the options record.
- **The namespace-once property**: a config file written by `AppConfig` lands under the namespace passed to `App.layer`, with **no namespace passed to `AppConfig` at all**. This is the test that pins the DX ruling; if someone later adds a `namespace` option "for flexibility", it should fail.
- **`App.layerTest` works with zero platform layers** — a test that provides nothing but `App.layerTest` and uses `Store` and `Cache`. If this ever needs a `NodeFileSystem` import, the layer has stopped doing its job.
- **A bad `filename` dies at construction** — empty, and one containing a separator, for each of the three filename options.

## Build

**As-built: `savvy.build.ts` carries no suppression at all, and needs none.** The design predicted this package might legitimately report `suppressed: 0` because it defines no class factories (the config-file adapters' precedent), and it does: `dist/prod/issues.json` is **`errors: 0, warnings: 0, suppressed: 0`** — the second package in the repo, after `@effected/walker`, with a genuinely empty suppression list. The standard `{ messageId: "ae-forgotten-export", pattern: "_base" }` entry was **not** added, because there is no synthesized `_base` symbol to suppress; adding it would be a suppression for a warning that cannot occur. Gate: a cold `pnpm build --filter @effected/app`, **never the raw script**.

**As-built — cross-package `{@link}` references resolve to `ae-unresolved-link`.** An intermediate build reported four `ae-*`/`tsdoc-` diagnostics, all of them TSDoc `{@link}` tags pointing at symbols in `@effected/xdg`, `@effected/store` and `@effected/config-file`. API Extractor resolves links within the package's own model only, so a link across a package boundary is unresolvable by construction rather than by mistake. **The house-safe spelling for a cross-package reference is a plain backticked name**, not `{@link}`; that is what shipped, and it is what the next package wiring several `@effected/*` peers into one TSDoc surface should reach for first.

Three workspace peers mean this package needs the **`prepare` script** (`turbo run build:dev`), per [package-setup.md](../package-setup.md#cross-package-build-dependencies): `publishConfig.linkDirectory` links `@effected/xdg`, `@effected/store` and `@effected/config-file` at their `dist/dev/pkg`, so all three must be built before this package's tests can resolve them in a fresh checkout.

## Consumer sketch

The end-to-end shape, compressed. The full version belongs in user docs.

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

Four services, one platform import, one namespace typed once, and every error in `AppError` on the typed channel. That is the whole package.
