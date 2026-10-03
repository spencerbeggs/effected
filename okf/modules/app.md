---
type: Module
title: app
description: The thin composition layer wiring xdg, config-file and store into an application control plane -- owns no domain logic, defines no service or error of its own, and re-exports nothing from the packages beneath it.
status: stable
kind: package
resource: ../../packages/app
layer: L2
tags:
  - architecture
sources:
  - id: app-package-json
    resource: ../../packages/app/package.json
  - id: app-claude-md
    resource: ../../packages/app/CLAUDE.md
generated:
  by: "okfit/claude-code"
  at: 2026-10-03T15:50:52Z
  body_sha256: d28a444843c615d55ba8b4e9f4dd620cd1c8649e0970fd0d86230a22c7a86216
---

# app

## Purpose and tier

`@effected/app` is the thin composition layer that wires
[xdg](xdg.md), [config-file](config-file.md) and [store](store.md) into
an application control plane — the layer an application composes at its
edge to get namespaced directories, a state database, a cache database
and a config file, all pointed at the same place, in one call.

It owns **no domain logic**. It defines no service, no schema and no
error class, and it **re-exports nothing** — see
[app is composition, not an umbrella](../decisions/app-is-composition-not-umbrella.md).
The entire public surface is layer factories, one config preset and one
type alias. **Nothing may depend on `@effected/app`**: a library taking
an application control plane as a dependency would drag tier 3 into its
consumers' trees, the exact leak [the dependency
policy](../conventions/dependency-policy.md)'s R2 exists to prevent. This
package sits at the top of the dependency graph.

**Integrated tier by R2 alone**: `@effected/store` is tier 3 through
`@effect/sql-sqlite-node`, and tier 3 propagates. The package has **zero
external runtime dependencies of its own** and does no IO the three
packages beneath it do not already do — its tier is inherited, not
earned.[^app-package-json] `peerDependencies` is `effect` plus
`@effected/xdg`, `@effected/store` and `@effected/config-file`;
`dependencies` is empty. The three workspace edges are **peers, not
regular dependencies**, because each appears in this package's public
signature types — a second copy of any of them in a consumer's graph
would mint two distinct service tags for one concept and the layer would
silently fail to satisfy the requirement. Direction is acyclic and
one-way: app → {xdg, store, config-file}. `@effect/platform-node` is a
devDependency for the real-filesystem integration tests only.

## Module layout

One module per concept under `src/` — `App.ts`, `AppStore.ts`,
`AppCache.ts`, `AppConfig.ts` — plus `internal/filename.ts` (the
path guards for `filename` and `subdir`) and `internal/location.ts`
(`ensureLocation`: the directory's `ensure*`, then the subdir's recursive
`mkdir`, both on `AppDirsError`). There is no engine here, nothing but
composition and those wiring-defect guards.

`AppConfig.ts` must stay a separate module and a free-standing export
from anything that reaches the sqlite driver: `AppConfig` reaches `xdg`
and `config-file` only, while `App`/`AppStore`/`AppCache` reach `store`
and through it `@effect/sql-sqlite-node`. A consumer who wants
XDG-placed config files and no database must be able to import
`AppConfig` without pulling a SQLite driver into their graph. Collecting
the four concepts into one `App = { ... }` namespace object would
destroy that silently — there is no namespace object here, matching
[the no-barrel convention](../conventions/no-barrel-re-exports.md) one
level up. `App.ts` imports `AppStore.ts` and `AppCache.ts` but **not**
`AppConfig.ts` — the import direction is what keeps the two graphs
separate.

Each of `App`, `AppStore`, `AppCache` and `AppConfig` is a static class
with a private constructor, not an `as const` namespace object, keeping
its TSDoc in the built declaration file.

## Public surface

### AppStore and AppCache — the database glue

Each is a `layer(options)` factory built with `Layer.unwrap`: yield
`AppDirs`, run the `ensure*` for the chosen `directory` (`"state"`,
`"data"` or `"cache"`; state for stores and cache for caches by
default), create an optional relative `subdir` beneath it with a
recursive `mkdir`, join a `filename`, and hand the path to
`Store.layerSqlite` / `Cache.layerSqlite`. The subdir `mkdir` is why both
modules carry `FileSystem` in `R`; its failure is mapped onto xdg's
`AppDirsError` (the directory kind, the full path), whose shape fits
exactly, so the failure stays typed without this package defining an
error. `AppStore.location` / `AppCache.location` expose that same
derivation without creating anything (`R` is `AppDirs | Path`). A
consumer that reports or persists the path therefore gets the file the
layer opens, never a parallel derivation that could drift. An absolute
or host-chosen path is deliberately not an option
here — that is store's `layerSqliteAs` — and every other option
(`client`, `checkpointOnClose`, `adoptMigratorLedger`) is store's,
passed through.
This ensure-before-open ordering is the entire reason this package
exists — see [The ensure-before-open contract](#the-ensure-before-open-contract).

Each also has a `layerAs(tag, options)` form for an application with more
than one database: the same glue, provided under a consumer-defined
`Context.Service` key over `StoreShape` / `CacheShape`, built on
store's `Store.layerSqliteAs` / `Cache.layerSqliteAs`. The inner
`Store` / `Cache` never leaks, so a keyed layer composes beside the
primary without shadowing it, each file with its own migrations, ledger
and location. Three
properties are deliberate:

- **`filename` is required** on `layerAs`. A defaulted `store.db` /
  `cache.db` would land a keyed layer silently on the primary's file —
  two connections and two migration ledgers on one database.
- **The key's shape is pinned against wider shapes.** A class key is
  checked structurally and method bivariance makes that effectively
  covariant, so the parameter is `Context.Key<I, S> & ([StoreShape]
  extends [S] ? unknown : never)` with `S extends StoreShape`: an
  unrelated shape, or one that adds members, is a compile error. The pin
  proves mutual assignability, not identity, so it cannot see through
  method-syntax parameter bivariance — a member redeclared as a method
  with a wider parameter still compiles.
- **A keyed map was rejected.** `App.layer({ stores: { … } })` would
  re-introduce the eager open below for every store and need an
  app-owned service to hold the map — the one thing this package never
  defines. N stores are N bound `layerAs` constants the application
  composes itself.

### App — the control plane

`App.layer(options)` returns all four services with only `FileSystem`
and `Path` left in `R`, for the consumer's platform layer to supply once
at the edge. `AppOptions` extends `AppDirsOptions` as pass-through —
those fields mean exactly what [xdg](xdg.md) says, precedence ladder
included — plus a required `store` and optional `cache`.

`App.layer` always provides **both** databases, and **building it opens
and migrates both eagerly**. A conditional-`Cache` flag would either lie
in the type or force a second layer type for no gain — but passing no
`cache` options **still opens `cache.db`**, because `CacheOptions` are
all-optional and absence means defaults, not absence.

`App.layerDirs(options)` is the directories half alone — exactly
`Layer.provideMerge(AppDirs.layer(options), Xdg.layer)`, giving `Xdg |
AppDirs` on `XdgEnvError` with `FileSystem | Path` in `R` — and
`App.layer` is built on it. It opens no database. It exists because the
eager open is wrong for a CLI: provided at `CliRuntime.main`, `App.layer`
created and migrated both files for every command in the
[reposets](../consumers/reposets.md) consumer, and its `nuke` command
deleted a `store.db` its own process held open. The CLI shape is
directories once at the edge, each database layer bound once at module
scope, and `Command.provide` on only the commands that use it.

### App.layerTest — the hermetic control plane

`App.layerTest(options)` returns the same four services with `R =
never`: synthetic XDG paths and `:memory:` databases, with `Path.layer`
and `FileSystem.layerNoop` provided internally (satisfied, not exposed).
A consumer's first test is one line and needs no platform package. This
is sound because `layerTest` **satisfies** those requirements rather than
imposing them, so `R` is `never` by construction and not by a cast. The
documented limit: code paths that actually exercise `ensure*` **die**
against `FileSystem.layerNoop` — it is a stub layer, not a working
filesystem — so a test of real directory behaviour uses `App.layer` with
a temp-directory `HOME` instead, which is what the integration suite
does.

### AppConfig — the xdg-flavored ConfigFile preset

`AppConfig.layer(tag, options)` wraps `ConfigFile.layer` with the
resolver chain xdg documents, in xdg's order, with an `XdgConfig` save
path that fits config-file's `defaultPath` slot without an `orDie`. Load
bearing decisions:

- **The namespace is never a parameter.** It is read from the ambient
  `AppDirs` service at layer build time, so it is typed exactly once, in
  `App.layer` — killing the two-strings drift where an app passes
  `"myapp"` to `App.layer` and `"my-app"` to its config preset.
- **Caller resolvers prepend; they never replace.** `options.resolvers`
  composes ahead of the XDG chain, in the order given, with
  `XdgConfig.resolver` and the native probe still behind it — absent the
  option the chain is exactly what it was. A caller resolver that finds
  nothing falls through to XDG, since every `ConfigResolver`'s error
  channel is `never` by contract and a miss is not an error; the save
  path is untouched, still `XdgConfig.savePath(filename)`.
- **`parseOptions` passes straight through to config-file**, unchanged
  and undefaulted, so an application can turn on excess-property
  rejection here without dropping to `ConfigFile.layer`.
- **The codec stays a required parameter.** Defaulting it, or inferring
  one from the filename's extension, would hard-code a format choice
  into a composition layer — not this package's decision. The caller
  names the codec, and that named import is also what keeps the other
  engines out of their bundle.
- **`native` defaults to `true`** — the opposite of `AppDirsOptions.native`,
  which defaults to `false`. Creating a native directory commits an
  application to a location, so it is opt-in; probing one for an
  existing config file costs only a `stat` that finds nothing, so it is
  opt-out.

### AppError — the app-edge catch surface

A **type-only** alias unioning the constituent packages' errors. It
erases, so it costs nothing in the module graph and creates no binding
to tree-shake around. It exists so the application edge has a
copy-pasteable `catchTags` list; it is a convenience over the
constituent errors, **not a new error model**, and it must not become a
wrapper class.

## The ensure-before-open contract

**The entire reason this package exists.** [store](../decisions/store-v4-sqlite.md#decision)
established that `SqliteClient.layer` has no error channel and defects
on a missing parent directory, so a package wiring a database path is
responsible for ensuring the directory exists before the layer is built
— nothing downstream can catch it typed. [xdg](xdg.md#public-surface)
supplies the other half: `AppDirs.ensure*` is a `mkdir -p` on a typed
`AppDirsError` channel. Composing them in that order — `AppStore.layer`
and `AppCache.layer` run the ensure inside `Layer.unwrap`, before the
store layer is built — converts a defect surface into a typed one.
Nothing is `orDie`d: "the state directory could not be created" is an
expected, recoverable boundary failure and it stays on `E`. The
integration suite watches a naive `Store.layerSqlite`-without-`ensureState`
composition defect; do not reorder the two.

## Errors

**No new error classes.** The constituent errors flow through typed and
unwrapped — a `StoreMigrationError` that reaches an application still
carries its migration identity, and re-wrapping it would destroy exactly
the structure the three ports' error redesigns built. **Wiring
defects**: a `filename` — store's, cache's, config's, or either
`layerAs` form's — dies at layer construction unless it is a single path
component, and a `subdir` dies unless it is a relative path of such
components. The guard in
`internal/filename.ts` rejects the empty string, anything containing a
separator, and the two traversal names `.` and `..` — weakening it to
"empty or contains a separator" would miss `".."`, which contains no
separator and still escapes the namespace directory.

## Observability

**No new spans, deliberately.** Every fallible operation inside the glue
is already spanned by the package that owns it; the glue only joins
paths and composes layers, so a span here would wrap another package's
span and tell an operator nothing new. The package stays
telemetry-agnostic, but as the app-edge package its docs carry the kit's
worked example of where OTel goes: the SDK layer composed once, at the
top, beneath the application's own layer stack — libraries never import
`@effect/opentelemetry`; applications do, exactly once. One caveat this
package hands its consumers: the `Cache` it wires stores byte values, and
Effect's `DateTimeUtc`/`Duration` schemas have no built-in transformation
to a serializable form, so anything encoded into a cache value needs the
`FromString`/`FromMillis` codecs rather than a bare `declare` schema.

## Memoization

Every export is a **parameterized layer factory**, so store's
layer-memoization trap applies here in full and at maximum cost. Effect
memoizes layers by reference; calling `App.layer(...)` inline at two
provide sites opens **two databases** — two connections onto one file,
two migration ledgers, and two independent `CacheEvent` PubSubs whose
subscribers each see half the events. **Bind the result to a `const`
once and reuse that binding** — this is the package where an application
is most likely to compose the same layer in two places, since `App.layer`
is the one call most examples reach for first.

## Testing

Suites in `__test__/`, integration under `__test__/integration/`.
`@effect/platform-node` backs the integration suite on the merits — the
ordering proofs are claims about a real filesystem. Preserved
properties: a fresh namespace with no pre-existing directories builds
without a defect; an unwritable ancestor surfaces a typed `AppDirsError`,
never a die; a config file lands under the namespace passed to
`App.layer` with none passed to `AppConfig` at all (the namespace-once
property); `App.layerTest` works with zero platform layers; and a caller
resolver outranks the XDG search path, proven with both files present
and different bodies so appending instead of prepending fails the
assertion. The filename guard is exercised through a shared matrix
(`__test__/filenameGuard.ts`) registered once per suite against each of
the five filename options. `App.layerDirs` is pinned to open no
database against a positive control (`App.layer` built and unused does
create both files), and the `layerAs` suites prove a primary and two
keyed stores coexist with disjoint tables and ledgers.

## Build

`savvy.build.ts` carries **no suppression and needs none** — the package
defines no class factories of its own, so there is no synthesized
`_base` symbol to suppress. Three workspace peers mean the `prepare`
script is load-bearing: `xdg`, `store` and `config-file` link at their
built output and must be built before this package's tests resolve them
in a fresh checkout. Cross-package `{@link}` references resolve to
`ae-unresolved-link` — API Extractor resolves links within a package's
own model only — so the house-safe spelling for a cross-package
reference is a plain backticked name, never a `{@link}`. Gate on a
zero-warning `dist/prod/issues.json` via `pnpm build --filter
@effected/app`.

## Consumer sketch

```ts
// Bound once — see Memoization.
const AppLive = App.layer({ namespace: "myapp", store: { migrations }, cache: { maxEntries: 500 } });

const ConfigLive = AppConfig.layer(SettingsFile, {
  filename: "config.json", // no namespace: it comes from AppLive's AppDirs
  schema: Settings,
  codec: JsonCodec,
});

const MainLive = ConfigLive.pipe(
  Layer.provideMerge(AppLive),
  Layer.provide(NodeServices.layer), // the one place a platform is named
);
```

Four services, one platform import, one namespace typed once, and every
error in `AppError` on the typed channel. The [reposets](../consumers/reposets.md)
consumer exercises this composition against a real filesystem, including
`Store.rollback` against a real on-disk database.

[^app-package-json]: `packages/app/package.json` — `peerDependencies`
    lists `@effected/config-file`, `@effected/store`, `@effected/xdg` and
    `effect`; no `dependencies` block.
