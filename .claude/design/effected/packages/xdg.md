---
status: current
module: effected
category: architecture
created: 2026-07-10
updated: 2026-08-25
last-synced: 2026-08-25
completeness: 95
related:
  - ../effect-standards.md
  - ../package-inventory.md
  - ../releases.md
  - ../package-setup.md
  - walker.md
  - config-file.md
  - store.md
  - app.md
  - memfs.md
---

# @effected/xdg design

## Overview

`@effected/xdg` is XDG Base Directory resolution. Its one job, stated precisely, is to **turn the environment into paths**: read the XDG Base Directory environment, map it onto a platform, namespace it for an application, create the directories on demand, and expose that as a config-file resolver chain.

No database, no cache, no format parsing. The SQLite services live in [@effected/store](store.md), and xdg **does not depend on it** — store is integrated tier, and depending on it would propagate under [R2](../effect-standards.md#dependency-policy). Keeping that edge out is what keeps xdg boundary tier.

Three separations are load-bearing: raw-env resolution vs namespaced resolution vs platform mapping; the documented multi-level precedence per directory; and a progressive layer ladder, so a consumer can adopt env resolution without adopting anything else.

## Tier and dependencies

**Boundary tier.** IO happens exclusively through `effect`-core `FileSystem` and `Path`, arriving via the `R` channel from the consumer's platform layer. `peerDependencies` is `effect`, `@effected/walker` and `@effected/config-file`; there are no runtime dependencies.

Both workspace edges are legal and cost xdg's consumers nothing:

- **walker** is boundary→boundary — legal under [R1](../effect-standards.md#dependency-policy), non-propagating under [R3](../effect-standards.md#dependency-policy). The graph stays acyclic, since walker depends on nothing.
- **config-file** is boundary→boundary and a **type-level** edge in substance: xdg produces values inhabiting config-file's resolver interface and consumes its default-path slot. It is a peer rather than a regular dependency because the bridge exposes config-file's types in xdg's own public signatures, so a single copy in the consumer's graph is load-bearing. Direction is config-file ← xdg, so no cycle, and xdg imports config-file's free-standing `JsonCodec`, never a namespace object.

`FileSystem` and `Path` are `effect` core in v4, so there is no `@effect/platform` peer and **no platform-node devDependency** — the layers tests need come from core, as in [walker](walker.md#testing).

## Module layout

Module-per-concept, four concept files under `src/`: `Xdg.ts` (the environment), `NativeDirs.ts` (the pure platform map), `AppDirs.ts` (namespace, precedence, creation) and `XdgConfig.ts` (the config-file bridge). See `src/` for exact signatures.

Import direction is a DAG: `Xdg.ts` depends on nothing, `NativeDirs.ts` and `AppDirs.ts` build on it, `XdgConfig.ts` builds on `AppDirs.ts`. There is **no `internal/` directory** — there is no engine here, only resolution. Co-locating each concept's tag, shape, errors and layers in one file means nothing cycles with anything.

## Public surface

### Xdg — the environment

Four decisions define the service:

- **The service's shape IS the resolved paths.** The environment does not change during a process, so resolution happens **once, at layer construction**, and the service is the resolved value rather than an effect that computes one. This is also what makes the whole downstream chain infallible.
- **`Option` is gone from the model.** `Schema.optionalKey` per the [schema standard](../effect-standards.md#schema-standards): an absent XDG variable is an absent key, and a `??` fallback is the read.
- **The system search paths are modeled**, not just the per-user home variables — the colon-separated `XDG_CONFIG_DIRS` and `XDG_DATA_DIRS` with their spec defaults. Modeling the search-path half of the spec is what makes the walker edge load-bearing rather than decorative (see [Where walker fits](#where-walker-fits)).
- **The platform is injected, never read from a global.** `CurrentPlatform` is a `Context.Reference` whose default reads `process.platform` once, so production is unchanged while a test pins macOS or Windows with a one-line `Layer.succeed` and no platform IO. This is what makes the [native-dirs matrix testable](#testing).

A missing `HOME` is the only environment failure; everything else is optional by construction. `layerFrom` supplies explicit paths and is the test layer.

### NativeDirs — the pure platform map

The mapping, which is the part worth stating because it is a policy and not a derivation:

- **darwin** — config, data and state under `~/Library/Application Support/<ns>`; cache under `~/Library/Caches/<ns>`.
- **win32** — config and data under `%APPDATA%/<ns>`; cache and state under `%LOCALAPPDATA%`. Absent environment variables fall back to the standard `AppData/Roaming` and `AppData/Local` locations under home.
- **everything else** — `Option.none()`. On Linux, XDG *is* the native convention, so returning `none` rather than a duplicate of the XDG answer lets the precedence ladder skip the rung cleanly.

`NativeDirs.resolve` takes the resolved `XdgPaths` rather than loose strings, and joins through `Path.Path`, so a win32 `Path` layer produces win32 separators. It is **pure** — no IO, no env, no clock — which is precisely why the platform matrix is exhaustively testable.

### AppDirs — namespace, precedence, creation

**Resolution happens once, at layer construction; the resolved directories are a plain value.** The inputs are fixed when the layer is built, so the computation belongs there. The consequences are not merely performance:

- Reading a path **cannot fail** — it is a `string`. The only fallible operations are the ones that touch the filesystem.
- The layer's error channel is `never`. The one failure that could hide behind it — a missing `HOME` — surfaces where it belongs, on the `Xdg` layer, before an `AppDirs` exists.
- The config-file save path gets an infallible channel, which is the only way it fits config-file's `defaultPath` slot without an `orDie`.

The **five-level precedence** per directory kind, documented honestly as a deviation from the XDG spec:

1. an explicit per-kind override;
2. the XDG environment variable, namespaced;
3. the native directory, when native mode is on and the platform has one;
4. a single dot-directory under `$HOME` that all four kinds collapse to;
5. `$HOME/.<namespace>`.

Rungs 4 and 5 are **not** the XDG spec's per-kind defaults. This is a deliberate choice — a CLI that wants spec defaults passes them as per-kind overrides — and it is stated in the TSDoc rather than left for a reader to discover. Native mode defaults **off**, because creating a native directory commits an application to a location.

The `ensure*` operations `mkdir -p` and return the path. The runtime one is `Option`-returning, because a runtime directory exists only when the environment (or an override) says so and there is no defensible fallback.

### XdgConfig — the config-file bridge

Statics on a concept class, matching the [house container form](../effect-standards.md#a-sanctioned-grouped-statics-container-is-a-static-class-not-an-as-const-object): a config-search-path resolver, a native-directory resolver and a save path.

The primary resolver searches the **whole XDG config search path** — the app's own config directory, then each system config directory, namespaced, in that order — which is what the spec has always said. Placement guidance for a chain: put it ahead of the native resolver, so an existing `~/.config/<app>` still beats the native directory. Both resolvers honour config-file's contract that resolution has a `never` error channel, and they get that from walker rather than a hand-rolled `catchAll`.

### Deliberately not present

- **Preset ladders and format-coupled factories.** With layers co-located and memoized by reference, composing the environment layer with a namespaced one is two lines at the consumer's edge. A preset that hard-codes a *format* choice is not xdg's decision to make; that composition belongs in [@effected/app](app.md).
- **A central error union.** `Schema.TaggedError` needs no intermediate, and a registry error union is a smell; each error lives with the concept that raises it.

## Where walker fits

Walker earns its edge in the one place xdg does a *search*: the config resolver builds the ordered candidate list from the app's config search path and hands it to `Walker.firstMatch`. That single call buys three properties:

- **Per-candidate absorption.** A permission failure on a system config directory must not hide a readable `~/.config`. `firstMatch` skips one bad candidate and continues, rather than a whole-resolver `catchAll` aborting the entire probe at the wrong granularity.
- **Short-circuiting.** The first hit wins; later candidates are never stat-ed.
- **Defects still propagate** — `firstMatch` uses `Effect.catch`, not `catchCause`.

The native resolver has exactly one candidate but goes through `firstMatch` too, for the absorption contract. Nothing in xdg ascends a directory chain, so walker's `ascend` and `findRoot` are unused: xdg's candidates come from the environment, not the tree. Without the system search paths modeled, `firstMatch` would be a one-element loop everywhere and the walker edge would be ceremony — which is why the search-path modeling matters.

## Error handling

Two `Schema.TaggedError` types, one per fallible concept, each carrying its underlying failure **structurally** in a `cause: Schema.Defect()` field: an environment error naming the missing variable, and a directory-creation error carrying the failing kind as a literal union plus the path. See `src/Xdg.ts` and `src/AppDirs.ts`.

Rulings, per the [error-handling standards](../effect-standards.md#error-handling-standards):

- **`PlatformError` is wrapped, never leaked**; the underlying failure lands in `cause` rather than being stringified.
- **The failing directory kind is a literal union**, so callers branch on it.
- **Nothing is `orDie`d.** "The cache directory could not be created" is an expected, recoverable boundary failure.
- **Wiring errors are construction defects.** An empty namespace, or one containing a path separator, dies at layer construction — it can only come from code, and a namespace with a separator in it would silently escape the app's directory.

## Observability

Named spans on **every public fallible boundary, uniformly**, per the [ceiling-and-floor rule](../effect-standards.md#observability-standards) — which here is exactly the `ensure*` set. Path *reads* are property accesses on a value and are unspanned; the two resolvers have a `never` channel by contract and carry no spans; the platform map is pure. No metrics, no logging, no `@effect/opentelemetry` — telemetry-agnostic.

## Testing

Suites in `__test__/`, one per concept module, with suite-boundary `layer(...)` blocks rather than a per-test `Effect.provide`.

**The platform matrix is tested with no platform IO at all** — the requirement that shaped the design. Because the platform is a `Context.Reference` and the native map is pure, a suite pins darwin/win32/linux behaviour by providing the reference at the group boundary and asserting on strings. The environment is injected the same way. `AppDirs`' filesystem behaviour runs on a real in-memory volume ([`@effected/memfs`](memfs.md), a devDependency) with `makeDirectory` intercepted by a **delegate-by-default spy**: the handler records the path and returns `undefined`, so the directory is genuinely created rather than merely observed, and the suite still asserts *which* directories were made, in which order.

The mutation-prone edges the suite pins: **one test per precedence rung**, each with the higher rungs absent and the lower present, so a rung that stopped mattering would be caught; the **native matrix** including win32 with and without its environment variables and linux skipping the rung entirely; **search-path order**, including that a file in an earlier system directory wins over a later one and that the app's own config directory beats both; **per-candidate absorption**, where a failure on the first candidate must not hide a hit on the second; that a **missing `HOME`** fails with the package's own error rather than a raw `ConfigError`, driven through a config provider rather than environment mutation; that a **namespace containing a separator dies** at layer construction; and that the **save path composes into config-file's default-path slot** end-to-end, which is the whole reason resolution moved to layer-construction time.

One fixture-authoring hazard is worth knowing before writing a double here. `AppDirs` builds its `ensure*` effects **once, at layer construction**, so anything that records eagerly counts directories that were never created and every assertion measures construction instead of execution. A hand-written stub that records eagerly needs an explicit `Effect.suspend` around its recording; a fault handler is consulted when the method is *called*, so the property comes free. That is a reason to prefer the handler — not a reason to stop knowing why it matters, because the same trap waits for any recorder written by hand.

`XdgConfig`'s suites stay on a core-only `layerNoop` double, because the resolvers touch the filesystem only through existence probes and the fixture's whole job is to record which candidates were probed and to deny one of them.

## Hardening

Not a parser — no recursion, no untrusted text, no nesting cap, no numeric option. What applies:

- **The namespace is a path component, validated as one.** An empty namespace, or one containing a separator, is rejected at layer construction as a defect, because it is wiring. Without that check, a `".."`-bearing namespace would resolve the app's config directory outside `$HOME`.
- **Every join goes through `Path.Path`**, never string interpolation — so no forward slashes on Windows and no missed normalization.
- **Absorption is per candidate, not per resolver** (see [Where walker fits](#where-walker-fits)).
- **Defects propagate** — xdg adds no `catchCause` anywhere.

## Build

`savvy.build.ts` carries the standard narrow suppression `{ messageId: "ae-forgotten-export", pattern: "_base" }` for the synthesized bases. Gate: zero-warning `dist/prod/issues.json` from a cold `pnpm build --filter @effected/xdg`. Both workspace peers mean xdg needs the **`prepare` script**, per [package-setup.md](../package-setup.md#cross-package-build-dependencies): the peers link at their built output, so they must be built before xdg's tests can resolve them in a fresh checkout.
