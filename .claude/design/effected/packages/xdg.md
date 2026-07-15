---
status: current
module: effected
category: architecture
created: 2026-07-10
updated: 2026-07-15
last-synced: 2026-07-15
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
---

# @effected/xdg design

## Overview

`@effected/xdg` is XDG Base Directory resolution — a **boundary-tier** package whose one job, stated precisely, is to **turn the environment into paths**: read the XDG Base Directory environment, map it onto a platform, namespace it for an application, create the directories on demand, and expose that as a config-file resolver chain. No database, no cache, no format parsing — the SQLite half of the original `xdg-effect` lives in [@effected/store](store.md), and xdg **does not depend on it** (store is integrated tier, and depending on it would propagate under [R2](../effect-standards.md#dependency-policy)).

Three separations are load-bearing: raw-env resolution vs namespaced resolution vs platform mapping; the documented multi-level precedence per directory; and a progressive layer ladder (adopt env resolution without adopting anything else).

## Tier and dependencies

**Boundary tier.** IO happens exclusively through `effect`-core `FileSystem` and `Path`, arriving via the `R` channel from the consumer's platform layer.

- `peerDependencies`: `effect`, `@effected/walker` (`workspace:*`), `@effected/config-file` (`workspace:*`).
- `dependencies`: **none**.
- `devDependencies` mirror the workspace peers, plus the standard build/test set.

Both workspace edges are legal and cost xdg's consumers nothing:

- **walker** is boundary→boundary. Legal under [R1](../effect-standards.md#dependency-policy), non-propagating under [R3](../effect-standards.md#dependency-policy). The graph stays acyclic — walker depends on nothing.
- **config-file** is boundary→boundary and a **type-level** edge in substance: xdg produces values inhabiting config-file's `ConfigResolver<R>` interface and consumes its `ConfigFileOptions.defaultPath` slot. It is a peer rather than a regular dependency because the bridge exposes config-file's types in xdg's own public signatures, so a single copy in the consumer's graph is load-bearing. Direction is config-file ← xdg, so no cycle. xdg imports config-file's free-standing `JsonCodec`, not a namespace object.

`FileSystem` and `Path` are `effect` core in v4, so there is no `@effect/platform` peer and **no `@effect/platform-node` devDependency** — `Path.layer` and `FileSystem.layerNoop` come from core, as in walker.

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

Import direction is a DAG: `Xdg.ts` → nothing; `NativeDirs.ts` → `Xdg.ts` (for `XdgPlatform`); `AppDirs.ts` → both; `XdgConfig.ts` → `AppDirs.ts`. There is no `internal/` directory — there is no engine here, only resolution. Co-locating a concept's tag, shape, errors and layers in one file means nothing cycles with anything.

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

Four decisions define the service:

- **The service's shape IS `XdgPaths`.** The environment does not change during a process, so resolution happens **once, at layer construction**, and the service is the resolved value. `yield* Xdg` gives `paths.home` directly. This is also what makes the whole downstream chain infallible.
- **`Option` is gone from the model.** `Schema.optionalKey` per the [schema standard](../effect-standards.md#schema-standards): an absent XDG variable is an absent key, and `paths.configHome ?? fallback` is the read.
- **`XDG_CONFIG_DIRS` and `XDG_DATA_DIRS` are modeled** — the colon-separated system search paths, defaulting to `/etc/xdg` and `/usr/local/share:/usr/share`. Modeling the search-path half of the spec is what makes walker load-bearing rather than decorative (see [Where walker fits](#where-walker-fits)).
- **The platform is injected, never read from a global.** `CurrentPlatform` is a `Context.Reference` whose default reads `process.platform` once, so production is unchanged and a test pins macOS or Windows with `Layer.succeed(CurrentPlatform, "darwin")` and no platform IO. This is what makes the [native-dirs matrix testable](#testing).

`XdgEnvError` is raised only when `HOME` is unset; everything else in the environment is optional by construction.

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

The mapping:

- **darwin** — `config`/`data`/`state` under `~/Library/Application Support/<ns>`; `cache` under `~/Library/Caches/<ns>`.
- **win32** — `config`/`data` under `%APPDATA%/<ns>`; `cache` under `%LOCALAPPDATA%/<ns>/Cache`; `state` under `%LOCALAPPDATA%/<ns>`. Absent env vars fall back to `<home>/AppData/Roaming` and `<home>/AppData/Local`.
- **everything else** — `Option.none()`. On Linux, XDG *is* the native convention, so returning `none` rather than a duplicate of the XDG answer lets `AppDirs`' precedence ladder skip the rung cleanly.

`NativeDirs.resolve` is a **class-with-a-static**, takes `XdgPaths` rather than loose strings, and joins through `Path.Path` (so a win32 `Path` layer produces win32 separators). It is **pure** — no IO, no env, no clock — which is precisely why the platform matrix is exhaustively testable.

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

**Resolution happens once, at layer construction; `dirs` is a plain value.** The inputs are fixed when the layer is built, so the computation belongs there. The consequences are not merely performance:

- Reading a path **cannot fail** — `appDirs.dirs.config` is a `string`. The only fallible operations are the ones that touch the filesystem.
- `AppDirs.layer`'s error channel is `never`. The one failure that could hide behind it — "HOME is unset" — surfaces where it belongs, on `Xdg.layer` as `XdgEnvError`, before an `AppDirs` exists.
- `XdgConfig.savePath` gets an infallible channel, the only way it fits config-file's `defaultPath?: Effect<string, never, RR>` slot without an `orDie`.

The **five-level precedence** per directory kind, documented honestly as a deviation from the XDG spec:

1. an explicit `dirs.<kind>` override;
2. the XDG env var, namespaced (`$XDG_CONFIG_HOME/<ns>`);
3. the native directory, when `native: true` and the platform has one;
4. `$HOME/<fallbackDir>` — all four kinds collapse to the one directory;
5. `$HOME/.<namespace>`.

Rungs 4 and 5 are **not** the XDG spec's per-kind defaults (`~/.config`, `~/.local/share`, …). This is a deliberate choice — a CLI that wants spec defaults passes them as `dirs` overrides — stated in the TSDoc rather than left for a reader to discover.

`ensure*` `mkdir -p`s and returns the path. `ensureRuntime` is `Option`-returning because a runtime directory exists only when `$XDG_RUNTIME_DIR` (or a `dirs.runtime` override) says so, and there is no defensible fallback. `ensure` creates all five and returns the full `ResolvedAppDirs`.

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

Statics on a concept object, matching `ConfigResolver.staticDir` / `Walker.ascend`. `resolver` searches the **whole XDG config search path** — `~/.config/<ns>/rc`, then `/etc/xdg/<ns>/rc`, in that order — which is what the spec has always said. Placement guidance: put `resolver` ahead of `nativeResolver` in a chain, so an existing `~/.config/<app>` still beats the native directory. Both resolvers honour config-file's contract that `resolve`'s error channel is `never`, and they get that from walker rather than a hand-rolled `catchAll` (see below).

### Deliberately not present

- **`XdgFull`-style presets and format-coupled `.toml`/`.json`/`.multi` factories.** With layers co-located and memoized by reference, `Layer.mergeAll(Xdg.layer, AppDirs.layer(opts).pipe(Layer.provide(Xdg.layer)))` is two lines at the consumer's edge. A preset that hard-coded a *format* choice is not xdg's decision to make after the config-file family split; that composition is documentation and belongs in [@effected/app](app.md).
- **A `json-schema` dependency** — nothing in `src/` uses it; it existed only to power a re-export facade, which the [no-barrel rule](../effect-standards.md#no-barrel-re-exports) forbids.
- **A central error union.** `Schema.TaggedErrorClass` needs no intermediate, and a registry error union is a smell; each error lives with the concept that raises it.

## Where walker fits

Walker earns its edge in the one place xdg does a *search*: `XdgConfig.resolver` builds the ordered candidate list from the app's config search path and hands it to `Walker.firstMatch(candidates, fs.exists)`. That single call buys three properties:

- **Per-candidate absorption.** An `EACCES` on `/etc/xdg` must not hide a readable `~/.config`. `firstMatch` skips one bad candidate and continues, rather than a whole-resolver `catchAll` aborting the entire probe at the wrong granularity.
- **Short-circuiting.** The first hit wins; later candidates are never stat-ed.
- **Defects still propagate** — `firstMatch` uses `Effect.catch`, not `catchCause`.

`nativeResolver` has exactly one candidate but goes through `firstMatch` too, for the absorption contract. Nothing in xdg ascends a directory chain, so `Walker.ascend` and `findRoot` are unused: xdg's candidates come from the environment, not the tree. Without `XDG_CONFIG_DIRS`, `firstMatch` would be a one-element loop everywhere and the walker edge would be ceremony — which is why the search-path modeling matters.

## Error handling

Two `Schema.TaggedErrorClass` types, one per fallible concept, each carrying its underlying failure **structurally**:

| Error | Fields | Raised by | Audience |
| --- | --- | --- | --- |
| `XdgEnvError` | `variable` (`Schema.String`), `cause` (`Schema.Defect()`) | `Xdg.layer` when `HOME` is unset | calling code (`_tag`) and the end user (`message` names the variable) |
| `AppDirsError` | `directory` (`Literals(["config","data","cache","state","runtime"])`), `path`, `cause` (`Schema.Defect()`) | any `ensure*` whose `mkdir -p` fails | calling code and the operator (via the span) |

Rulings, per the [error-handling standards](../effect-standards.md#error-handling-standards):

- **`PlatformError` is wrapped, never leaked**; the `ConfigError` from a missing `HOME` lands in `cause` rather than being stringified.
- **`directory` is a literal union**, so callers branch on the failing kind.
- **Nothing is `orDie`d.** "the cache directory could not be created" is an expected, recoverable boundary failure.
- **Wiring errors are construction defects.** An empty `namespace`, or one containing a path separator, dies at `AppDirs.layer` construction — it can only come from code, and a namespace with a `/` in it would silently escape the app's directory.

## Observability

Named spans on **every public fallible boundary, uniformly**, per the [house ceiling-and-floor rule](../effect-standards.md#observability-standards): `AppDirs.ensureConfig`, `.ensureData`, `.ensureCache`, `.ensureState`, `.ensureRuntime`, `.ensure` — the complete set of operations that can fail. Path *reads* (`appDirs.dirs.config`) are property accesses on a value and are unspanned; the two resolvers have a `never` channel by contract and carry no spans; `NativeDirs.resolve` is pure. No metrics, no logging, no `@effect/opentelemetry` — telemetry-agnostic.

## Testing

`@effect/vitest`, `it.effect`, `assert.*` — never `expect`; suite-boundary `layer(...)` blocks, never a per-test `Effect.provide`.

**The platform matrix is tested with no platform IO at all** — the requirement that shaped the design. Because `CurrentPlatform` is a `Context.Reference` and `NativeDirs.resolve` is pure, a suite pins darwin/win32/linux behaviour by providing `Layer.succeed(CurrentPlatform, "win32")` at the group boundary and asserting on strings. The environment is injected the same way, through `Xdg.layerFrom(XdgPaths.make({...}))`. Filesystem behaviour uses core layers only: `Path.layer` (POSIX) and `FileSystem.layerNoop({ exists, makeDirectory })`, with a recording `makeDirectory` stub asserting *which* directory was created, in which order.

Required coverage, mutation-prone edges first:

- **Precedence, one test per rung**, each with the higher rungs absent and the lower present, so a rung that stopped mattering would be caught. In particular: `dirs.config` beats an XDG var; an XDG var beats the native dir; the native dir beats `fallbackDir`; `fallbackDir` beats `$HOME/.<ns>`; and `native: false` skips rung 3 even on darwin.
- **The native matrix**: darwin, win32 with both env vars, win32 with neither (the `AppData/Roaming` fallback), and linux (`Option.none()` — the rung is skipped).
- **Search-path order**: with `XDG_CONFIG_DIRS=/a:/b`, the config search path is `[<confighome>/<ns>, /a/<ns>, /b/<ns>]`; a file only in `/b` is found; a file in both `/a` and `/b` resolves to `/a`; a file in the app's own config dir beats both.
- **Per-candidate absorption**: `fs.exists` failing on the first candidate must not hide a hit on the second.
- **`Xdg.layer` with `HOME` unset fails with `XdgEnvError`**, not a `ConfigError` — driven by `ConfigProvider.layer(ConfigProvider.fromUnknown({}))`, no environment mutation.
- **`ensure*` maps a `mkdir` failure to `AppDirsError`** with the right `directory` and `path`, and `ensure` creates all five (runtime rung skipped when absent).
- **A namespace containing a separator is a defect at layer construction** (`Effect.exit` + `Cause.isDieReason`).
- **`savePath` composes into `ConfigFileOptions.defaultPath`** — an end-to-end test through the real `ConfigFile.layer` proving the `never` channel fits the slot, the whole reason resolution moved to layer-construction time.

A `FileSystem.layerNoop` stub must record inside `Effect.suspend`: the `AppDirs` shape builds its `ensure*` effects once, at layer construction, so a stub whose `makeDirectory` pushes eagerly records directories that were never created and every assertion then measures construction instead of execution.

## Hardening

Not a parser — no recursion, no untrusted text, no `MAX_NESTING_DEPTH`, no numeric option. What applies:

- **The namespace is a path component, validated as one.** An empty namespace, or one containing `/`, `\` or a separator, is rejected at layer construction (as a defect — it is wiring). Without that check, `namespace: "../.."` would resolve the app's config directory outside `$HOME`.
- **Every join goes through `Path.Path`**, never string interpolation — so no forward slashes on Windows and no missed normalization.
- **Absorption is per candidate, not per resolver** (see [Where walker fits](#where-walker-fits)).
- **Defects propagate** — `Walker.firstMatch` uses `Effect.catch`; xdg adds no `catchCause` anywhere.

## Build

`savvy.build.ts` carries the standard narrow suppression `{ messageId: "ae-forgotten-export", pattern: "_base" }` for the synthesized bases. Gate: zero-warning `dist/prod/issues.json` from a cold `pnpm build --filter @effected/xdg`. Both workspace peers mean xdg needs the **`prepare` script** (`turbo run build:dev`), per [package-setup.md](../package-setup.md#cross-package-build-dependencies): `publishConfig.linkDirectory` links `@effected/walker` and `@effected/config-file` at their `dist/dev/pkg`, so they must be built before xdg's tests can resolve them in a fresh checkout.
