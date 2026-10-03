# @effected/app

The application control plane: one layer wiring XDG-namespaced directories, a
migrated SQLite `Store`, a TTL `Cache` and a config file to the same place.
The **fifteenth and final** migration — and the seventeenth workspace package,
after the sixteen merged before it. The only greenfield one: it is the honest
successor to the v3 glue the `xdg` and `store` ports deliberately parked
(`XdgFullLive`, `SqliteStateXdgLive`, `SqliteCacheXdgLive`).

**Design doc:** `@./okf/modules/app.md`

## It owns no domain logic — that is the whole identity

This is a **composition layer**. It defines **no service, no schema, no error
class**, and it **re-exports nothing** from the packages beneath it. The entire
public surface is layer factories, one config preset and one type alias.

If a change here wants a `Context.Service`, that is the signal the change
belongs in `xdg`, `store` or `config-file` instead. A consumer who wants config
files alone takes `config-file` alone.

## Tier: integrated

Integrated by **R2 alone**: `@effected/store` is tier 3 (through
`@effect/sql-sqlite-node`) and tier 3 propagates. This package has **zero
runtime dependencies of its own** and does no IO the three packages beneath it
do not already do. Its tier is inherited, not earned.

`peerDependencies` is `effect` plus `@effected/xdg`, `@effected/store` and
`@effected/config-file` (each `workspace:^`, so a published patch floats,
mirrored into `devDependencies` as the plain `workspace:*` — the two
specifiers now deliberately differ).
They are **peers, not regular dependencies**, because each appears in this
package's public signature types — a second copy of `AppDirs` or `Store` in a
consumer's graph would mint two service tags for one concept and the layer would
silently fail to satisfy the requirement.

**Nothing may depend on `@effected/app`.** A library taking an application
control plane drags tier 3 into its consumers under R2 — the leak the taxonomy
exists to prevent. This is also why no consumer was blocked on it and why it
could be sequenced last.

## Four modules, and the split is load-bearing

`App.ts` (`AppOptions`, `AppTestOptions`, `AppError`, `App.layer`,
`App.layerDirs`, `App.layerTest`) · `AppStore.ts` (`layer`, `layerAs`) ·
`AppCache.ts` (`layer`, `layerAs`) · `AppConfig.ts`. There is no
engine here, only composition — two `internal/` modules. `internal/filename.ts`
holds the path guards: `badFilename` rejects any `filename` that is not a single
path component (the same wiring-defect rule `xdg` applies to `namespace`), and
`badSubdir` rejects a `subdir` that is not a relative path of such components.
`AppStore`, `AppCache` and `AppConfig` import it, so a newly rejected shape is
added there once; its test-side mirror is `__test__/filenameGuard.ts`
(`filenameGuardCases`, `subdirGuardCases`). It is load-bearing, not a helper:
without it a path option escapes the app's own directory.
`internal/location.ts` holds the location's two halves. `resolveLocation`
guards `filename`/`subdir` and joins `AppDirs.dirs[kind]`, the subdir and the
filename, creating nothing. It is the ONE derivation behind both the public
`AppStore.location` / `AppCache.location` and the layers. A consumer reports
or persists the path the layer opens, so a second derivation would be a drift
bug; the integration suite asserts equality. `ensureLocation` is the
ensure-before-open half: the matching `AppDirs.ensure*`, then a recursive
`mkdir` of the subdir mapped onto `AppDirsError` (directory kind, full path).

`App.ts` imports `AppStore.ts` and `AppCache.ts`. **`App.ts` does not import
`AppConfig.ts`**, and that is the point: `AppConfig` reaches `xdg` +
`config-file` only, while `App` / `AppStore` / `AppCache` reach `store` and
through it the SQLite driver. A consumer who wants XDG-placed config files and
no database must be able to import `AppConfig` without pulling a driver into
their graph.

**There is no namespace object here, and never will be** — this is
config-file's rule one level up (it measured 506 bytes versus 129.4 kB).
Collecting the four concepts into one `App = { … }` would destroy the split
silently.

`App`, `AppStore`, `AppCache` and `AppConfig` are each a static class with a
private constructor, not an `as const` namespace object — an `as const`
object's member types are inferred in the built `.d.ts` and lose their TSDoc
entirely, while a class's `static readonly` declarations keep it. Call syntax
is unaffected (`App.layer(...)`); each internal implementation stays a plain
function, carrying only a one-line pointer comment, with the full contract
TSDoc living on the static.

## The ensure-before-open contract

**The entire reason this package exists.** `SqliteClient.layer` has **no error
channel** and **defects** on a missing parent directory; `AppDirs.ensure*` is a
`mkdir -p` on a **typed** `AppDirsError` channel. `AppStore.layer` and
`AppCache.layer` run the ensure inside `Layer.unwrap`, *before* the store layer
is built, which converts a defect surface into a typed one.

Nothing is `orDie`d — v3's `SqliteStateXdgLive` laundered the `AppDirsError`
away to advertise a `never` channel. "The state directory could not be created"
is an expected, recoverable boundary failure and it stays on `E`. The
integration suite watches a naive `Store.layerSqlite`-without-`ensureState`
composition defect; do not reorder the two.

## Invariants

- **The namespace is never an `AppConfig` parameter.** It is read from the
  ambient `AppDirs` service at layer build time, so it is typed **exactly once,
  in `App.layer`**. This kills the two-strings drift where an app passes
  `"myapp"` to `App.layer` and `"my-app"` to its config preset and then reads
  config from a directory nothing else ever writes to. If someone adds a
  `namespace` option "for flexibility", the namespace-once test should fail.
- **`AppConfigOptions.resolvers` prepends, never replaces.** Caller resolvers lead;
  `XdgConfig.resolver` and the native probe stay behind them, so absent the option
  the chain is byte-for-byte what it always was. It exists for the `--config` flag
  case (reposets dogfood round 1, 2026-08-13). Two properties the tests pin: a
  caller resolver that finds nothing **falls through** to XDG — resolver error
  channels are `never` by contract, so a missing `--config` file is a miss and not
  an error — and the **save path is unaffected**, still `XdgConfig.savePath`.
- **The chain is caller-controlled at both ends, and the whole chain is
  removable** (okfit dogfood, 2026-09-07). `resolversAfter` appends behind every
  built-in tier; `systemEtc` inserts `ConfigResolver.systemEtc` **behind** the XDG
  pair, namespaced from the ambient `AppDirs` like everything else here; `xdg:
  false` drops the XDG resolver **and the native probe with it** — the probe is
  the tail of the XDG fallback chain, not a tier of its own, so `native` is
  ignored while `xdg` is false. Assembly order is
  `resolvers → xdg → native → systemEtc → resolversAfter`, and a chain wanting a
  different position for the system tier leaves `systemEtc` absent and passes
  `ConfigResolver.systemEtc` itself. **`defaultPath` is unaffected by `xdg:
  false`**: dropping the discovery tier says nothing about where the app saves,
  so `save` still writes `XdgConfig.savePath(filename)` — which is precisely why
  a `--config` branch no longer has to drop to `ConfigFile.layer` and re-supply
  it.
- **`AppConfigOptions.parseOptions` is a pass-through to `ConfigFileOptions`**, not
  a new concept. It exists for `onExcessProperty: "error"`, which is what lets a
  config loader report a typo'd section or a field the schema deliberately
  removed; `validate` cannot, because it runs after decoding has already dropped
  the excess keys. Absent = core's `"ignore"`, so it is additive.
- **`AppConfig.layer`'s key is pinned against wider shapes**, with
  the same conditional as `layerAs` (`S extends ConfigFileShape<A>`, defaulted,
  so explicit four-argument calls still compile). Before, a class key over
  `ConfigFileShape<A> & { extra }` was accepted. `ConfigFile.Service` keys —
  every caller in the repo and in reposets — are unaffected.
  `@effected/config-file`'s own `ConfigFile.layer` / `testLayer` carry the same
  pin.
- **The codec stays required** on `AppConfigOptions` — never defaulted, never
  inferred from the filename's extension. Hard-coding a *format* choice into a
  composition layer is exactly what `XdgFullLive` was killed for, and the named
  import is what keeps the other three engines out of the consumer's bundle.
- **`App.layer` always provides both databases, and opens them eagerly.**
  Building it creates and migrates `store.db` and `cache.db` whether or not the
  program touches them. Passing no `cache` options **still opens `cache.db`** —
  `CacheOptions` are all-optional, so absence means defaults, not absence. An app
  that wants only one, or wants them only on some code paths, composes
  `App.layerDirs` with `AppStore.layer` / `AppCache.layer` (#923).
- **`App.layerDirs` opens no database.** It is exactly
  `Layer.provideMerge(AppDirs.layer(options), Xdg.layer)` — `Xdg | AppDirs` on
  `XdgEnvError`, `R = FileSystem | Path` — and `App.layer` is built on it, so the
  two cannot drift. It exists for the CLI shape: directories provided once at
  `CliRuntime.main`, each database bound once at module scope and attached with
  `Command.provide` only on the commands that use it. Reposets hit the eager
  open in production: every command created both files, and `nuke` deleted a
  `store.db` its own process held open. The integration suite pins the property
  with a positive control (`App.layer` built and unused DOES create both files).
- **`layerAs` is the multi-database surface, and its `filename` is required**
  (#97). `AppStore.layerAs(tag, options)` / `AppCache.layerAs(tag, options)` take
  a consumer-defined `Context.Service` key over `StoreShape` /
  `CacheShape` and output **that key alone**: they resolve the path and hand it
  to `Store.layerSqliteAs` / `Cache.layerSqliteAs`, whose re-tag never leaks the
  inner `Store` / `Cache`, so a keyed layer composes beside the primary without
  shadowing it. `filename` has
  no default because a defaulted `store.db` / `cache.db` would land silently on
  the primary's file — two connections and two ledgers on one database. Do not
  give it one.
- **The key's shape is pinned against wider shapes.** A class key
  is checked against `Context.Key` structurally and method bivariance makes that
  effectively covariant, so a plain `Context.Service<I, StoreShape>` parameter
  accepted a `StoreShape & { extra }` key and handed it a value missing `extra`.
  The signature is `<I, S extends StoreShape>(tag: Context.Key<I, S> &
  ([StoreShape] extends [S] ? unknown : never), …)`; the type tests pin
  unrelated, wider and missing-filename as compile errors. The cost is a
  cryptic "not assignable to `never`" for the wider case, documented on the
  static. **The limit:** the pin proves mutual assignability, not identity, so
  it cannot see through method-syntax parameter bivariance — a shape that
  redeclares a member as a method with a wider parameter
  (`rollback(toId: number | string)`) still compiles. Never describe the key as
  "exactly" the shape.
- **A keyed map was rejected.** `App.layer({ stores: { registry: … } })` would
  reintroduce #923's eager open for every store and need an app-owned service
  to hold the map — the one thing this package never defines. N stores are N
  bound `layerAs` consts, composed by the application.
- **`AppOptions` is `AppDirsOptions` pass-through.** `namespace`, `native`,
  `fallbackDir`, `dirs` mean what xdg says they mean, five-level precedence
  ladder included. This package re-documents none of it.
- **`location` resolves without creating.** `AppStore.location(options)` /
  `AppCache.location(options?)` return `Effect<string, never, AppDirs | Path>`.
  `R` deliberately has no `FileSystem`: if it needed one, it would be doing IO
  the contract says it does not. The same bad-`filename`/`subdir` dies as the
  layers, with the `.location` context.
- **`directory` and `subdir` are the location, and the failure stays typed.**
  `AppStoreOptions` / `AppCacheOptions` take `directory: "state" | "data" |
  "cache"` (defaults: state for stores, cache for caches) and a relative
  `subdir` created with `mkdir -p` after the directory is ensured. That `mkdir`
  is why `AppStore.*` and `AppCache.*` carry `FileSystem` in `R`, and its
  failure is mapped onto `AppDirsError` — `directory` the kind, `path` the full
  subdir path — because its shape fits exactly and this package defines no error
  of its own. An absolute or host-chosen path is **not** an app option: that is
  `Store.layerSqliteAs` / `Cache.layerSqliteAs` from `@effected/store`, which
  `layerAs` builds on. The rest of the options (`client`, `checkpointOnClose`,
  `adoptMigratorLedger`) are store's, passed through untouched.
- **A `filename` must be a single path component**, or it dies at construction —
  for all five filename options (store, cache and config, plus both `layerAs`;
  the die names `AppStore.layerAs` / `AppCache.layerAs` for the keyed ones), and
  every component of a `subdir` (which additionally may not be absolute). The guard rejects the empty string, anything
  containing `/` or `\`, and the traversal names `.` and `..`. Do not weaken it
  to "empty or contains a separator": `filename: ".."` contains no separator and
  still escapes the namespace directory. It can only come from code — the same
  wiring-defect rule xdg applies to `namespace`.
- **`AppError` is a type-only alias** (`XdgEnvError | AppDirsError | StoreError
  | StoreMigrationError | CacheError`). It erases, so it costs nothing in the
  module graph. It is the copy-pasteable `catchTags` list for the app edge, **not
  a new error model** — every constituent error flows through unwrapped with its
  structure intact. Do not turn it into a wrapper class.
- **No new spans, deliberately.** Every fallible operation inside the glue is
  already spanned by the package that owns it; the glue joins paths and composes
  layers. A span here would wrap another package's span.

## The memoization trap, at maximum cost

Every export is a **parameterized layer factory**, and Effect memoizes layers
**by reference**. Calling `App.layer(…)` inline at two provide sites opens **two
databases**: two connections onto one file, two migration ledgers, and two
independent `CacheEvent` PubSubs whose subscribers each see half the events.

**Bind the result to a `const` once and reuse that binding.** Say so at the top
of any example — this is the package where an application is most likely to
compose the same layer twice.

## App.layerTest and its documented limit

`layerTest` provides `Path.layer` and `FileSystem.layerNoop` **internally** via
`Layer.provide` — not merged into the output, not exposed — over
`Xdg.layerFrom` on synthetic paths and `:memory:` databases. A consumer's first
test is one line and needs **no platform package**. This is sound because the
layer *satisfies* those requirements rather than imposing them; `R` is `never`
by construction, not by a cast.

**The limit:** code paths that actually exercise `ensure*` **die** against
`FileSystem.layerNoop` — it is a stub, not a working filesystem. `layerTest` is
for testing logic that *uses* the control plane. Real directory behaviour —
the `ensure*` members — is tested by composing `AppDirs.layer` over
`@effected/memfs` (as `@effected/xdg`'s own `AppDirs` suite does), never by
stubbing `FileSystem.layerNoop` better. The databases cannot follow: `Store`
and `Cache` open SQLite files through the native binding, which never sees the
`FileSystem` service, so `App.layer` end to end still runs against a
temp-directory `HOME` — which is what the integration suite does.

The unit suites follow the same rule. `AppConfig.test.ts` seeds a memfs volume
with real config bodies and asserts saves on a pinned handle's volume;
`AppStore.test.ts` and `AppCache.test.ts` provide an empty volume whose
`makeDirectory` is faulted with `MemoryFileSystem.die`, so construction stops at
`ensure*` before the SQLite binding could open a file on the host disk.

## Testing and building

Unit tests in `__test__/`, integration under `__test__/integration/*.int.test.ts`;
`@effect/vitest`, `assert.*` — never `expect`. Unit tests' `FileSystem` double
is `@effected/memfs`. `@effect/platform-node` is a devDependency for the
real-filesystem integration tests only.

```bash
pnpm vitest run packages/app       # from the repo root
pnpm build --filter @effected/app  # from the repo root
```

- `savvy.build.ts` carries **no `_base` suppression** — this package defines no
  class factories of its own, so there is nothing to suppress. Do not add one
  speculatively.
- Three workspace peers mean the **`prepare` script is load-bearing**: `xdg`,
  `store` and `config-file` link at their `dist/dev/pkg` and must be built before
  this package's tests resolve them in a fresh checkout.
- Never run `node savvy.build.ts --target prod` directly.
