---
status: current
module: effected
category: architecture
created: 2026-07-10
updated: 2026-07-11
last-synced: 2026-07-11
completeness: 95
related:
  - ../effect-standards.md
  - ../migration-playbook.md
  - ../package-inventory.md
  - ../releases.md
  - ../package-setup.md
  - walker.md
  - config-file.md
  - store.md
---

# @effected/xdg design

## Overview

**Merged** — the **eleventh** package migration and a **boundary-tier** package. It is the XDG half of the `xdg-effect` split decided 2026-07-09 in [package-inventory.md](../package-inventory.md); the SQLite half shipped as [@effected/store](store.md), and `@effected/xdg` **does not depend on it**. The split is what keeps xdg at tier 2: store is integrated tier, and depending on it would propagate ([R2](../effect-standards.md#dependency-policy)).

This document is the design as specified, with an [As built](#as-built-2026-07-11) section recording what the port landed. The sections below are accurate unless that section says otherwise.

What remains is one job, stated precisely: **turn the environment into paths.** Read the XDG Base Directory environment, map it onto a platform, namespace it for an application, create the directories on demand, and expose that as a config-file resolver chain. No database, no cache, no format parsing.

Three things the v3 library got right survive verbatim as concepts: the separation of raw-env resolution from namespaced resolution from platform mapping; the documented multi-level precedence for a directory; and the progressive layer ladder (adopt env resolution without adopting anything else). Everything else is redesigned.

## Tier and dependencies

**Boundary tier.** IO happens exclusively through `effect`-core `FileSystem` and `Path`, which arrive via the `R` channel from the consumer's platform layer — walker's discipline, and the same profile as [@effected/config-file](config-file.md).

- `peerDependencies`: `effect` (`catalog:effect`), `@effected/walker` (`workspace:*`), `@effected/config-file` (`workspace:*`).
- `dependencies`: **none**.
- `devDependencies` mirror the workspace peers, plus the standard build/test set.

Both workspace edges are checked against the [dependency policy](../effect-standards.md#dependency-policy):

- **walker** is boundary→boundary. Legal under [R1](../effect-standards.md#dependency-policy) (a boundary package may take `@effected/*` edges) and costs xdg's consumers nothing under [R3](../effect-standards.md#dependency-policy) (tier 2 does not propagate). The graph stays acyclic: walker depends on nothing.
- **config-file** is also boundary→boundary, and is a **type-level** edge in substance — xdg produces values inhabiting config-file's `ConfigResolver<R>` interface and consumes its `ConfigFileOptions.defaultPath` slot. It is declared a peer rather than a regular dependency for the reason the [xdg review](../../reviews/xdg.md) §6 gives: the bridge exposes config-file's types in its own public signatures, so a single copy in the consumer's graph is load-bearing. This is the same shape `@effected/config-file-jsonc` uses for its two workspace peers. Direction is config-file ← xdg, never the reverse, so no cycle.

The v3 `json-schema-effect` dependency is **cut entirely** — nothing in `src/` used it; it existed only to power a re-export facade, which the [no-barrel rule](../effect-standards.md#no-barrel-re-exports) forbids anyway.

`@effect/platform` disappears as a peer: `FileSystem` and `Path` are `effect` core in v4. There is **no `@effect/platform-node` devDependency**, in tests or otherwise — `Path.layer` and `FileSystem.layerNoop` come from core, exactly as in walker.

## Module layout

Module-per-concept, four concept files:

```text
packages/xdg/
  src/
    Xdg.ts           # XdgPlatform, CurrentPlatform, XdgPaths, XdgEnvError,
                     # Xdg service + layer / layerFrom
    NativeDirs.ts    # NativeDirs class + static resolve — the pure platform map
    AppDirs.ts       # AppDirsOptions, ResolvedAppDirs, AppDirsError,
                     # AppDirs service + layer
    XdgConfig.ts     # the config-file bridge: resolver, nativeResolver, savePath
    index.ts         # public surface, re-exports only
  __test__/
    Xdg.test.ts
    NativeDirs.test.ts
    AppDirs.test.ts
    XdgConfig.test.ts
```

The v3 layout — `errors/`, `layers/`, `schemas/`, `services/`, `resolvers/` — carried **eleven** `biome-ignore lint/suspicious/noImportCycles` comments, one for every service that imported its own layer file and back. Module-per-concept dissolves all eleven for free: the tag, the shape, the errors and the layers of one concept live in one file, and there is nothing to cycle with.

Import direction is a DAG: `Xdg.ts` → nothing; `NativeDirs.ts` → `Xdg.ts` (for `XdgPlatform`); `AppDirs.ts` → both; `XdgConfig.ts` → `AppDirs.ts`. No `internal/` directory — there is no engine here, only resolution.

## Public surface

### Xdg — the environment

```ts
export const XdgPlatform: Schema.Literals<["aix", "android", "darwin", "freebsd",
  "haiku", "linux", "openbsd", "sunos", "win32", "cygwin", "netbsd"]>;
export type XdgPlatform = typeof XdgPlatform.Type;

/** The platform every path decision is taken against. */
export const CurrentPlatform: Context.Reference<XdgPlatform>;   // default: process.platform ?? "linux"

class XdgPaths extends Schema.Class<XdgPaths>("XdgPaths")({
  home: Schema.String,
  configHome: Schema.optionalKey(Schema.String),   // $XDG_CONFIG_HOME
  dataHome: Schema.optionalKey(Schema.String),
  cacheHome: Schema.optionalKey(Schema.String),
  stateHome: Schema.optionalKey(Schema.String),
  runtimeDir: Schema.optionalKey(Schema.String),
  appData: Schema.optionalKey(Schema.String),      // %APPDATA%
  localAppData: Schema.optionalKey(Schema.String), // %LOCALAPPDATA%
  configDirs: Schema.Array(Schema.String),         // $XDG_CONFIG_DIRS, split
  dataDirs: Schema.Array(Schema.String),           // $XDG_DATA_DIRS, split
}) {}

class Xdg extends Context.Service<Xdg, XdgPaths>()("@effected/xdg/Xdg") {
  static readonly layer: Layer<Xdg, XdgEnvError>;          // reads the environment
  static layerFrom(paths: XdgPaths): Layer<Xdg>;           // explicit values; the test layer
}
```

Four decisions, each a departure from v3:

- **The service's shape IS `XdgPaths`.** v3's `XdgResolverService` was nine `Effect`s, every one of which re-read the environment on every access. The environment does not change during a process, so resolution happens **once, at layer construction**, and the service is the resolved value. `yield* Xdg` gives you `paths.home` directly. This is also what makes the whole downstream chain infallible (below).
- **`Option` is gone from the model.** `Schema.optionalKey` per the [schema standard](../effect-standards.md#schema-standards): an absent XDG variable is an absent key, and `paths.configHome ?? fallback` is the read. v3 forced `Option.some(...)` / `Option.none()` into both the model and the *construction* API, which the review called out.
- **`XDG_CONFIG_DIRS` and `XDG_DATA_DIRS` are modeled.** v3 ignored the search-path half of the XDG spec entirely. They are the colon-separated system search paths, defaulting to `/etc/xdg` and `/usr/local/share:/usr/share`. Adding them is what makes walker load-bearing rather than decorative (see [Where walker fits](#where-walker-fits)).
- **The platform is injected, never read from a global.** v3 reached for `globalThis.process?.platform ?? "linux"` from *inside* two otherwise dependency-injected code paths. It is now a `Context.Reference` whose default reads `process.platform` once — so production is unchanged, and a test pins macOS or Windows behaviour with `Layer.succeed(CurrentPlatform, "darwin")` and no platform IO whatsoever. This is what makes the [native-dirs matrix testable](#testing).

`XdgEnvError` is raised only when `HOME` is unset. Everything else in the environment is optional by construction.

### NativeDirs — the pure platform map

```ts
class NativeDirs extends Schema.Class<NativeDirs>("NativeDirs")({
  config: Schema.String, data: Schema.String, cache: Schema.String, state: Schema.String,
}) {
  static resolve(input: {
    readonly platform: XdgPlatform;
    readonly namespace: string;
    readonly paths: XdgPaths;
    readonly path: Path.Path;
  }): Option.Option<NativeDirs>;
}
```

The mapping is v3's, verbatim in behaviour:

- **darwin** — `config`/`data`/`state` under `~/Library/Application Support/<ns>`; `cache` under `~/Library/Caches/<ns>`.
- **win32** — `config`/`data` under `%APPDATA%/<ns>`; `cache` under `%LOCALAPPDATA%/<ns>/Cache`; `state` under `%LOCALAPPDATA%/<ns>`. Absent env vars fall back to `<home>/AppData/Roaming` and `<home>/AppData/Local`.
- **everything else** — `Option.none()`. On Linux, XDG *is* the native convention, so there is no override to apply. Returning `none` rather than a duplicate of the XDG answer is what lets `AppDirs`' precedence ladder skip the rung cleanly.

Three changes from v3: it is a **class with a static**, not a lowercase floating function colliding with its own PascalCase interface; it takes `XdgPaths` rather than three loose strings; and it joins through `Path.Path` rather than interpolating `/`, so a win32 `Path` layer produces win32 separators. The function is still **pure** — no IO, no env, no clock — which is precisely why the platform matrix is exhaustively testable.

### AppDirs — namespace, precedence, creation

```ts
interface AppDirsOptions {
  readonly namespace: string;
  /** Use OS-native directories where the platform has them. Default false. */
  readonly native?: boolean;
  /** A single dot-directory under $HOME that all four kinds collapse to. */
  readonly fallbackDir?: string;
  /** Absolute per-kind overrides; each wins outright. */
  readonly dirs?: {
    readonly config?: string; readonly data?: string; readonly cache?: string;
    readonly state?: string;  readonly runtime?: string;
  };
}

class ResolvedAppDirs extends Schema.Class<ResolvedAppDirs>("ResolvedAppDirs")({
  config: Schema.String, data: Schema.String, cache: Schema.String, state: Schema.String,
  runtime: Schema.optionalKey(Schema.String),
  /** Where to LOOK for a config file: the app config dir, then each $XDG_CONFIG_DIRS entry, namespaced. */
  configSearchPath: Schema.Array(Schema.String),
  dataSearchPath: Schema.Array(Schema.String),
}) {}

interface AppDirsShape {
  readonly namespace: string;
  readonly dirs: ResolvedAppDirs;                            // a value, not an Effect
  readonly ensureConfig: Effect<string, AppDirsError>;
  readonly ensureData: Effect<string, AppDirsError>;
  readonly ensureCache: Effect<string, AppDirsError>;
  readonly ensureState: Effect<string, AppDirsError>;
  readonly ensureRuntime: Effect<Option.Option<string>, AppDirsError>;
  readonly ensure: Effect<ResolvedAppDirs, AppDirsError>;    // all of the above
}

class AppDirs extends Context.Service<AppDirs, AppDirsShape>()("@effected/xdg/AppDirs") {
  static layer(options: AppDirsOptions):
    Layer<AppDirs, never, Xdg | FileSystem.FileSystem | Path.Path>;
}
```

**Resolution happens once, at layer construction; `dirs` is a plain value.** v3 recomputed all eight env reads plus the native mapping on *every* property access, and `resolveSingleDir` resolved all four directories to return one. The inputs are fixed when the layer is built, so the computation belongs there. The consequences are not merely performance:

- Reading a path **cannot fail**. There is no `Effect` to yield and no error to handle: `appDirs.dirs.config` is a `string`. The only fallible operations left are the ones that touch the filesystem.
- `AppDirs.layer`'s error channel is `never`. The one failure that used to hide behind `AppDirsError({ directory: "all" })` was "HOME is unset", and that now surfaces where it belongs — on `Xdg.layer`, as `XdgEnvError`, before an `AppDirs` exists at all.
- `XdgConfig.savePath` gets an infallible channel, which is the *only* way it fits config-file's `defaultPath?: Effect<string, never, RR>` slot without an `orDie`.

The **five-level precedence** per directory kind is v3's, kept verbatim and still documented honestly as a deviation from the XDG spec:

1. an explicit `dirs.<kind>` override;
2. the XDG env var, namespaced (`$XDG_CONFIG_HOME/<ns>`);
3. the native directory, when `native: true` and the platform has one;
4. `$HOME/<fallbackDir>` — all four kinds collapse to the one directory;
5. `$HOME/.<namespace>`.

Rungs 4 and 5 are **not** the XDG spec's per-kind defaults (`~/.config`, `~/.local/share`, …). This is a deliberate, inherited choice — a CLI that wants spec defaults passes them as `dirs` overrides — and the departure is stated in the TSDoc rather than left for a reader to discover.

`ensure*` `mkdir -p`s and returns the path. `ensureRuntime` is `Option`-returning because a runtime directory exists only when `$XDG_RUNTIME_DIR` (or a `dirs.runtime` override) says so; there is no defensible fallback for it, and inventing one would be a lie. `ensure` creates all five and returns the full `ResolvedAppDirs`.

### XdgConfig — the config-file bridge

```ts
const XdgConfig = {
  /** Search the app's XDG config search path for `filename`. */
  resolver(options: { readonly filename: string }):
    ConfigResolver<AppDirs | FileSystem.FileSystem>,

  /** Probe the OS-native config directory for `filename`. */
  nativeResolver(options: { readonly namespace: string; readonly filename: string }):
    ConfigResolver<Xdg | FileSystem.FileSystem | Path.Path>,

  /** The default save target: `<app config dir>/<filename>`. */
  savePath(filename: string): Effect<string, never, AppDirs | Path.Path>,
} as const;
```

Three renames and one behavioural upgrade. `XdgConfigResolver` → `XdgConfig.resolver`, `NativeConfigResolver` → `XdgConfig.nativeResolver`, `XdgSavePath` → `XdgConfig.savePath`: statics on the concept object, matching `ConfigResolver.staticDir` / `Walker.ascend` and killing v3's `Object.assign(fn, { toml, json, … })` callable-with-methods hybrids, which are hostile to docs generation and tree-shaking.

The upgrade is that `resolver` searches the **whole XDG config search path**, not just the app's config home — `~/.config/<ns>/rc`, then `/etc/xdg/<ns>/rc`, in that order — which is what the spec has always said and what v3 never did. Placement guidance is unchanged: put `resolver` ahead of `nativeResolver` in a chain, so an existing `~/.config/<app>` still beats the native directory.

Both resolvers honour config-file's contract that `resolve`'s error channel is `never`. They get that from walker rather than from a hand-rolled `Effect.catchAll(() => Option.none())` — see below.

### What is deliberately NOT ported

- **`XdgLive`, `XdgConfigLive`, `XdgFullLive`, the `.toml`/`.json`/`.multi`/`.layered` presets.** The review's naming-fog finding, taken at its word. With layers co-located and memoized by reference, `Layer.mergeAll(Xdg.layer, AppDirs.layer(opts).pipe(Layer.provide(Xdg.layer)))` is two lines at the consumer's edge and says what it does; `XdgFullLive` never did. The preset factories additionally hard-coded a *format* choice, which after the config-file family split is not xdg's decision to make. The composition they encoded is documentation, and it belongs in `@effected/app-kit`, which the [inventory](../package-inventory.md#internal-packages-no-source-repo) already scopes as exactly this glue.
- **`XdgResolverTest`'s `node:fs` temp directory.** It reached past the platform abstraction for `mkdtempSync`. `Xdg.layerFrom` needs no filesystem at all — it takes the paths — and a test that wants real directories uses `FileSystem.makeTempDirectory`.
- **`*ErrorBase` exports and `errors/types.ts`.** `Schema.TaggedErrorClass` needs no intermediate, and the central `XdgEffectError` union is a registry smell; each error lives with the concept that raises it.

## Where walker fits

Walker earns its edge in exactly one place, and it is the one place xdg does a *search*: `XdgConfig.resolver` builds the ordered candidate list from the app's config search path and hands it to `Walker.firstMatch(candidates, fs.exists)`.

That single call buys three properties xdg would otherwise have to restate:

- **Per-candidate absorption.** An `EACCES` on `/etc/xdg` must not hide a readable `~/.config`. v3 wrapped the whole resolver in one `Effect.catchAll(() => Option.none())`, which absorbs at the wrong granularity: a failure anywhere aborted the entire probe. With `firstMatch`, one bad candidate is skipped and the scan continues — and this is a real bug fixed, not a refactor.
- **Short-circuiting.** The first hit wins; later candidates are never stat-ed.
- **Defects still propagate.** `firstMatch` uses `Effect.catch`, not `catchCause`.

`nativeResolver` has exactly one candidate, so it goes through `firstMatch` too — for the absorption contract, not for the loop. Nothing in xdg ascends a directory chain, so `Walker.ascend` and `findRoot` are not used: xdg's candidates come from the environment, not from the tree. That is honest, and it is why the search-path modeling matters — without `XDG_CONFIG_DIRS`, `firstMatch` would be a one-element loop everywhere and the walker edge would be ceremony.

## Error handling

Two `Schema.TaggedErrorClass` types, one per fallible concept. v3 had four, all carrying `reason: string` populated by `String(e)` — the review's "stringly-typed payloads destroy cause structure" finding. Both replacements carry their underlying failure **structurally**.

| Error | Fields | Raised by | Audience |
| --- | --- | --- | --- |
| `XdgEnvError` | `variable` (`Schema.String`), `cause` (`Schema.Defect()`) | `Xdg.layer` when `HOME` is unset | calling code (`_tag`) and the end user (`message` names the variable) |
| `AppDirsError` | `directory` (`Literals(["config","data","cache","state","runtime"])`), `path`, `cause` (`Schema.Defect()`) | any `ensure*` whose `mkdir -p` fails | calling code (`_tag` + `directory` to branch, `path` to report) and the operator (via the span) |

Rulings, per the [error-handling standards](../effect-standards.md#error-handling-standards):

- **`PlatformError` is wrapped, never leaked**; the `ConfigError` from a missing `HOME` likewise lands in `cause` rather than being stringified.
- **`directory` is a literal union, not a `string`.** v3's `directory: "all"` sentinel — used for the "resolution failed" case that no longer exists — is gone with it.
- **Nothing is `orDie`d.** v3's `SqliteCacheXdgLive` laundered `AppDirsError` into a defect to advertise a `never` channel; that whole family moved to store and app-kit, and the discipline holds here: "the cache directory could not be created" is an expected, recoverable boundary failure.
- **Wiring errors are construction defects.** An empty `namespace`, or one containing a path separator, dies at `AppDirs.layer` construction: it can only come from code, and a namespace with a `/` in it would silently escape the app's directory. This is the [input-vs-wiring ruling](../effect-standards.md#error-handling-standards) — there is no numeric option here, so the `NaN` guard has no surface to apply to.

## Observability

Named `Effect.fn`/`withSpan` spans on **every public fallible boundary, uniformly**, per the [house ceiling-and-floor rule](../effect-standards.md#observability-standards): `AppDirs.ensureConfig`, `.ensureData`, `.ensureCache`, `.ensureState`, `.ensureRuntime`, `.ensure`. That is the complete list, because it is the complete set of operations that can fail.

Everything else is deliberately unspanned and that is not an omission:

- Path *reads* (`appDirs.dirs.config`) are property accesses on a value, not operations.
- The two resolvers have a `never` error channel by contract, exactly like config-file's own resolvers, which carry no spans either. Spanning an infallible probe would add noise proportional to the search-path length.
- `NativeDirs.resolve` is a pure function.

No metrics (the app meters its call), no logging, no `@effect/opentelemetry` — telemetry-agnostic throughout. v3 had zero observability of any kind.

## Testing

`@effect/vitest`, `it.effect`, `assert.*` — never `expect`; suite-boundary `layer(...)` blocks, never a per-test `Effect.provide`. The v3 suite (14 files of plain `it()` + `Effect.runPromise` + `expect` + `mkdirSync` + `Date.now()`-suffixed `/tmp` directories) is rewritten, not ported.

**The platform matrix is tested with no platform IO at all** — the requirement that shaped the design. Because `CurrentPlatform` is a `Context.Reference` and `NativeDirs.resolve` is pure, a suite pins darwin/win32/linux behaviour by providing `Layer.succeed(CurrentPlatform, "win32")` at the group boundary and asserting on strings. No `process.platform` stubbing, no `@effect/platform-node`, no real directories. The environment is injected the same way, through `Xdg.layerFrom(XdgPaths.make({...}))`, so a Windows fixture is a plain record.

Filesystem behaviour uses core layers only: `Path.layer` (POSIX) and `FileSystem.layerNoop({ exists, makeDirectory })`. A recording `makeDirectory` stub is how `ensure*` is asserted — *which* directory was created, in which order, and that a failure surfaces as `AppDirsError` and not a `PlatformError`.

Required coverage, mutation-prone edges first (the [mutate-the-edges discipline](../effect-standards.md#testing-standards)):

- **Precedence, one test per rung, each with the higher rungs absent and the lower rungs present** — so a rung that stopped doing anything would be caught. In particular: `dirs.config` beats an XDG var; an XDG var beats the native dir; the native dir beats `fallbackDir`; `fallbackDir` beats `$HOME/.<ns>`; and `native: false` skips rung 3 even on darwin.
- **The native matrix**: darwin, win32 with both env vars, win32 with *neither* (the `AppData/Roaming` fallback), and linux (`Option.none()` — the rung is skipped, not filled with a duplicate).
- **Search-path order**: with `XDG_CONFIG_DIRS=/a:/b`, the config search path is `[<confighome>/<ns>, /a/<ns>, /b/<ns>]`; a file present only in `/b` is found; a file present in both `/a` and `/b` resolves to `/a`; a file in the app's own config dir beats both. The last is the ordering test that a candidate-major or reversed implementation fails.
- **Per-candidate absorption**: `fs.exists` *failing* on the first candidate must not hide a hit on the second. This is the v3 bug; it gets a test that fails against v3's whole-resolver `catchAll`.
- **`Xdg.layer` with `HOME` unset fails with `XdgEnvError`**, not a `ConfigError` — driven by `ConfigProvider.layer(ConfigProvider.fromUnknown({}))`, so no environment mutation.
- **`ensure*` maps a `mkdir` failure to `AppDirsError` with the right `directory` and `path`**, and `ensure` creates all five (with the runtime rung skipped when absent).
- **A namespace containing a separator is a defect at layer construction** (`Effect.exit` + `Cause.isDieReason`, asserting no `Fail` reason — the discriminating assertion).
- **`savePath` composes into `ConfigFileOptions.defaultPath`** — an end-to-end test through the real `ConfigFile.layer` proving the `never` channel actually fits the slot, which is the whole reason resolution moved to layer-construction time.

## Hardening

Not a parser. There is no recursion, no untrusted text, no `MAX_NESTING_DEPTH`, and no numeric option — so most of the [input-hardening standards](../effect-standards.md#input-hardening-standards) have no surface here. What does apply:

- **The namespace is a path component, and it is validated as one.** An empty namespace, or one containing `/`, `\` or a path separator, is rejected at layer construction (as a defect — it is wiring, not input). Without that check, `namespace: "../.."` would resolve the app's config directory outside `$HOME` entirely. v3 accepted any string.
- **Every join goes through `Path.Path`**, never string interpolation. v3 built every path with `${home}/Library/...` templates, which produce forward slashes on Windows and, worse, do no normalization.
- **Absorption is per candidate, not per resolver** (see [Where walker fits](#where-walker-fits)) — the one place a v3 behaviour was actually wrong rather than merely awkward.
- **Defects propagate.** `Walker.firstMatch` uses `Effect.catch`; a predicate that throws stays a defect, and xdg adds no `catchCause` anywhere.

## Build

`savvy.build.ts` carries the standard narrow suppression `{ messageId: "ae-forgotten-export", pattern: "_base" }` for the synthesized bases: `XdgPaths`, `NativeDirs`, `ResolvedAppDirs`, the two error classes and the two `Context.Service` classes. Gate: zero-warning `dist/prod/issues.json` from a cold `pnpm build --filter @effected/xdg`, never the raw script.

Both workspace peers mean xdg needs the **`prepare` script** (`turbo run build:dev`), per [package-setup.md](../package-setup.md#cross-package-build-dependencies): `publishConfig.linkDirectory` links `@effected/walker` and `@effected/config-file` at their `dist/dev/pkg`, so they must be built before xdg's tests can resolve them in a fresh checkout.

## As built (2026-07-11)

Merged with **51 tests**, the whole repo green at 3594/3594, and a cold build whose zero-warning `issues.json` suppresses exactly seven synthesized class-factory `_base` symbols. The four-module layout, the boundary tier, the zero runtime dependencies and the no-platform-package-even-in-tests posture all landed as designed, and the json-schema facade was cut as predicted.

The port landed the design without structural deviation. Three things are worth recording because they were only learned by doing it:

1. **The per-candidate absorption bug and the search-path ordering were both watched *failing* against the v3 shape before the fix was committed.** They are the two tests that justify the walker edge, and a test that has not been seen red proves nothing about a bug it claims to pin. `XdgConfig.resolver` must keep going through `Walker.firstMatch` — a local loop with a trailing `catch` reintroduces exactly the whole-resolver absorption granularity that let one unreadable `/etc/xdg` hide a perfectly readable `~/.config`.
2. **A `FileSystem.layerNoop` stub must record inside `Effect.suspend`.** The `AppDirs` shape builds its `ensure*` effects once, at layer *construction*, which is the design's central decision — so a stub whose `makeDirectory` pushes eagerly in its body records four directories that were never created, and every assertion then measures construction instead of execution. This bit during the port and is the direct cost of resolving once; it is worth paying, but the test-shape consequence has to be known up front.
3. **The `never` error channel is what makes the config-file composition typecheck at all.** `XdgConfig.savePath` fits `ConfigFileOptions.defaultPath?: Effect<string, never, RR>` only because resolution moved to layer-construction time. There is an end-to-end test through the real `ConfigFile.layer` proving the slot accepts it without an `orDie` — that test *is* the justification for the resolve-once shape, and it should not be reduced to a unit test of `savePath` in isolation.
