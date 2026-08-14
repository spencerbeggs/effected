---
status: current
module: effected
category: architecture
created: 2026-07-12
updated: 2026-08-14
last-synced: 2026-08-14
completeness: 92
related:
  - ../effect-standards.md
  - ../package-inventory.md
  - ../releases.md
  - ../package-setup.md
  - ../consumers/reposets.md
  - store.md
  - xdg.md
  - config-file.md
  - cli.md
---

# @effected/app design

## Overview

`@effected/app` is the thin composition layer that wires [@effected/xdg](xdg.md), [@effected/config-file](config-file.md) and [@effected/store](store.md) into an **application control plane** — the layer an application composes at its edge to get namespaced directories, a state database, a cache database and a config file, all pointed at the same place, in one call.

**It owns no domain logic.** It defines no service, no schema and no error class, and it **re-exports nothing** — the [no-barrel rule](../effect-standards.md#no-barrel-re-exports) holds, so a consumer who wants config files alone takes `config-file` alone. The entire public surface is layer factories, one config preset and one type alias. If a change here wants a `Context.Service`, that is the signal the change belongs in one of the three packages beneath it instead.

**Nothing may depend on `@effected/app`.** A library taking an application control plane as a dependency would drag tier 3 into its consumers' trees under [R2](../effect-standards.md#dependency-policy) — the leak the taxonomy exists to prevent. This package sits at the top of the graph, and that is also why nothing was ever blocked on it.

## Tier and dependencies

**Integrated tier by [R2](../effect-standards.md#dependency-policy) alone**: `@effected/store` is tier 3 (through `@effect/sql-sqlite-node`) and tier 3 propagates. The package has **zero external runtime dependencies of its own** and does no IO the three packages beneath it do not already do — its tier is inherited, not earned.

`peerDependencies` is `effect` plus `@effected/xdg`, `@effected/store` and `@effected/config-file`; `dependencies` is empty. The three workspace edges are **peers, not regular dependencies**, because each appears in this package's public signature types (`AppDirs`/`AppDirsError` from xdg, `Store`/`Cache` and their options and errors from store, `ConfigFileOptions` and the codec/strategy seams from config-file). A second copy of any of them in a consumer's graph would mint two distinct service tags for one concept and the layer would silently fail to satisfy the requirement — single copies are load-bearing, which is what a peer declares. Direction is acyclic and one-way: app → {xdg, store, config-file}.

`@effect/platform-node` is a devDependency for the real-filesystem integration tests only.

## Module layout

Four modules under `src/`, plus `internal/filename.ts` (the single-path-component guard). There is no engine here — nothing but composition and that one wiring-defect guard.

`AppConfig.ts` must stay a **separate module and a free-standing export** from anything that reaches the sqlite driver. This is the [namespace-object / tree-shaking rule](config-file.md#the-load-bearing-constraint-free-standing-named-exports-never-a-namespace-object) applied one level up: `AppConfig` reaches `xdg` + `config-file` only, while `App` / `AppStore` / `AppCache` reach `store` and through it `@effect/sql-sqlite-node`. A consumer who wants XDG-placed config files and no database must be able to import `AppConfig` without pulling a SQLite driver into their graph. Collecting the four concepts into one `App = { … }` namespace object would destroy that silently — **there is no namespace object here either.** The import direction is what keeps the two graphs separate: `App.ts` imports `AppStore.ts` and `AppCache.ts` but **not** `AppConfig.ts`.

Each of the four is a **static class with a private constructor**, not an `as const` namespace object. An `as const` object's member types are inferred in the built `.d.ts` and lose their TSDoc entirely; a class's `static readonly` declarations keep it. Call syntax is unaffected, and each implementation stays a plain function with the contract TSDoc living on the static.

## Public surface

See `src/` for exact signatures; the load-bearing shapes and decisions:

### AppStore and AppCache — the database glue

Each is a `layer(options)` factory built with `Layer.unwrap`: yield `AppDirs`, run `ensure{State,Cache}`, join the directory with a `filename`, hand the path to `Store.layerSqlite` / `Cache.layerSqlite`.

**The ensure-before-open ordering is the load-bearing glue — it is the entire reason this package exists.** [store.md](store.md#the-v4-sqlite-decision) records that `SqliteClient.layer` has **no error channel** and **defects** on a missing parent directory, so a package wiring a database path is responsible for ensuring the directory exists *before* the layer is built; nothing downstream can catch it typed. [xdg.md](xdg.md#appdirs--namespace-precedence-creation) supplies the other half: `AppDirs.ensure*` is a `mkdir -p` on a **typed** `AppDirsError` channel. Composing them in that order converts a defect surface into a typed one, and nothing is `orDie`d — "the state directory could not be created" is an expected, recoverable boundary failure and it stays on `E`. Do not reorder the two.

### App — the control plane

`App.layer(options)` returns all four services with only `FileSystem` and `Path` left in `R`, for the consumer's platform layer to supply once at the edge. `AppOptions` extends `AppDirsOptions` as **pass-through** — those fields mean exactly what [xdg.md](xdg.md#appdirs--namespace-precedence-creation) says, precedence ladder included, and this package re-documents none of it — plus a required `store` and optional `cache`.

`App.layer` always provides **both** databases. An application that wants only one composes `AppStore.layer` or `AppCache.layer` directly. A conditional-`Cache` flag would either lie in the type or force a second layer type for no gain — but note the consequence honestly: passing no `cache` options **still opens `cache.db`**, because `CacheOptions` are all-optional and absence means defaults, not absence.

### App.layerTest — the hermetic control plane

`App.layerTest(options)` returns the same four services with `R = never`: synthetic XDG paths and `:memory:` databases, with `Path.layer` and `FileSystem.layerNoop` provided **internally** (satisfied, not exposed). A consumer's first test is one line and needs no platform package. This is the one place the package reaches past a boundary; it is sound because `layerTest` **satisfies** those requirements rather than imposing them, so `R` is `never` by construction and not by a cast.

The documented limit: code paths that actually exercise `ensure*` **die** against `FileSystem.layerNoop` — it is a stub layer, not a working filesystem. `layerTest` is for testing logic that *uses* the control plane; a test of real directory behaviour uses `App.layer` with a temp-directory `HOME`, which is what the integration suite does.

### AppConfig — the xdg-flavored ConfigFile preset

`AppConfig.layer(tag, options)` wraps `ConfigFile.layer` with the resolver chain xdg documents, in xdg's order, so an existing `~/.config/<app>` still beats the native directory, and with an `XdgConfig` save path that fits config-file's `defaultPath` slot **without an `orDie`** because xdg moved resolution to layer-construction time. The load-bearing decisions:

- **The namespace is never a parameter.** It is read from the ambient `AppDirs` service at layer build time, so it is typed **exactly once, in `App.layer`**. This kills the two-strings drift where an app passes `"myapp"` to `App.layer` and `"my-app"` to its config preset and then reads config from a directory nothing else writes to. Anything derivable is not asked for.
- **Caller resolvers prepend; they never replace.** `options.resolvers` is composed *ahead* of the XDG chain, in the order given, with `XdgConfig.resolver` and the native probe still behind it — so absent the option the chain is exactly what it was, and the default is unchanged. Added in the `@spencerbeggs/reposets` dogfood loop (round 1, 2026-08-13), whose blocker was the case the preset could not express: a CLI's `--config` flag has to outrank the app's own search path, and reaching for `ConfigFile.layer` to get it meant rebuilding by hand the XDG wiring `AppConfig` exists to own. Two consequences are documented rather than designed away — a caller resolver that finds nothing **falls through** to XDG, because every `ConfigResolver`'s error channel is `never` by contract and a missing `--config` file is therefore a miss and not an error; and the **save path is untouched**, still `XdgConfig.savePath(filename)`, so writing back to a flag-named file is `write(value, path)`. The deliberate limit: a chain needing the XDG resolvers anywhere but last, or not at all, has outgrown the preset and should compose `ConfigFile.layer` directly — the option buys the common case, not arbitrary chain surgery.
- **`parseOptions` passes straight through to config-file**, unchanged and undefaulted, so an application turns on excess-property rejection here without dropping to `ConfigFile.layer`. The preset adds no policy of its own: the decision, and why the `validate` hook cannot stand in for it, is [config-file's](config-file.md#decode-options-and-why-validate-cannot-substitute).
- **The codec stays a required parameter.** Defaulting it, or inferring one from the filename's extension, would hard-code a *format* choice into a composition layer — not this package's decision. The caller names the codec, and that named import is also what keeps the other engines out of their bundle.
- **`native` defaults to `true`** — the opposite of `AppDirsOptions.native`, which defaults to `false`. The asymmetry is deliberate: *creating* a native directory commits an application to a location, so it is opt-in; *probing* one for an existing config file costs a `stat` that finds nothing, so it is opt-out. Reading a config a user already put in `~/Library/Application Support` is a courtesy; writing there uninvited is not.

One implementation note worth not "helpfully" undoing: the resolver array carries an explicit annotation, because TypeScript would otherwise infer the element type from the first resolver alone and reject the wider requirements of the native resolver.

### AppError — the app-edge catch surface

A **type-only** alias unioning the constituent packages' errors. It erases, so it costs nothing in the module graph and creates no binding to tree-shake around. It exists so the application edge has a copy-pasteable `catchTags` list; it is a convenience over the constituent errors, **not a new error model**, and it must not become a wrapper class.

## Errors

**No new error classes.** The constituent errors flow through typed and unwrapped — a `StoreMigrationError` that reaches an application still carries its migration identity, and re-wrapping it would destroy exactly the structure the three ports' error redesigns built.

**Wiring defects** per the [input-vs-wiring ruling](../effect-standards.md#error-handling-standards): a `filename` — store's, cache's or config's — dies at layer construction unless it is a single path component. The guard in `internal/filename.ts` rejects the empty string, anything containing a separator, and the two traversal names `.` and `..`. Do not weaken it to "empty or contains a separator": `".."` contains no separator and still escapes the namespace directory. This package has no numeric options of its own; pass-through numerics are guarded by store, which owns them.

## Observability

**No new spans, deliberately.** Every fallible operation inside the glue is already spanned by the package that owns it. The glue joins paths and composes layers; a span here would wrap another package's span and tell an operator nothing new, so the [ceiling-and-floor rule](../effect-standards.md#observability-standards) is satisfied by construction.

The package stays telemetry-agnostic, but as the **app-edge package** its docs carry the kit's worked example of where OTel goes: the SDK layer composed **once, at the top**, beneath the application's own layer stack. Libraries never import `@effect/opentelemetry`; applications do, exactly once.

One caveat this package hands its consumers: the `Cache` it wires stores **byte** values, and Effect's `DateTimeUtc` / `Duration` schemas have no built-in transformation to a serializable form, so anything encoded into a cache value needs the `FromString` / `FromMillis` codecs rather than a bare `declare` schema.

## Memoization

Every export is a **parameterized layer factory**, so [store's layer-memoization trap](store.md#the-layer-trio) applies in full and at maximum cost. Effect memoizes layers **by reference**; each call to `App.layer(…)` builds a new one, and calling a factory inline at two provide sites opens **two databases** — two connections onto one file, two migration ledgers, and two independent `CacheEvent` PubSubs whose subscribers each see half the events. **Bind the result to a `const` once and reuse that binding**, and say so at the top of any example: this is the package where an application is most likely to compose the same layer in two places.

## Testing

Suites in `__test__/`, integration under `__test__/integration/`. `@effect/platform-node` backs the integration suite because core ships no working in-memory `FileSystem`. The ordering proofs carry the design's weight — the ensure-before-open ordering is this package's only real claim, and a test that does not watch it fail proves nothing. Four properties are the ones to preserve if these suites are ever rewritten:

- **A fresh namespace with no pre-existing directories builds without a defect**, watched failing against a naive compose that skips the ensure.
- **An unwritable ancestor surfaces a typed `AppDirsError`, never a die** — the anti-`orDie` regression.
- **The namespace-once property** — a config file lands under the namespace passed to `App.layer`, with none passed to `AppConfig` at all. If someone adds a `namespace` option "for flexibility", this fails.
- **`App.layerTest` works with zero platform layers** — if this ever needs a platform import, the layer has stopped doing its job.
- **A caller resolver outranks the XDG search path** — proven with both files present and different bodies, so appending instead of prepending fails the assertion rather than passing quietly. Verified as a mutant: flipping the two spread positions in the chain fails exactly two tests.

The filename guard is exercised through a shared matrix (`__test__/filenameGuard.ts`) registered once per suite against each of the three filename options.

## Build

`savvy.build.ts` carries **no suppression and needs none**: the package defines no class factories, so there is no synthesized `_base` symbol to suppress. Gate on a cold `pnpm build --filter @effected/app`, never the raw script.

Cross-package `{@link}` references resolve to `ae-unresolved-link` — API Extractor resolves links within the package's own model only, so a link across a package boundary is unresolvable by construction. **The house-safe spelling for a cross-package reference is a plain backticked name.** Three workspace peers mean the `prepare` script is load-bearing, so the three link at their built output before this package's tests resolve them in a fresh checkout ([package-setup.md](../package-setup.md#cross-package-build-dependencies)).

## Consumer sketch

The end-to-end shape, compressed; the full version belongs in user docs.

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

Four services, one platform import, one namespace typed once, and every error in `AppError` on the typed channel.
