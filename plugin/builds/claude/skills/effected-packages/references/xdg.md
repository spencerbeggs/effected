# @effected/xdg

XDG Base Directory resolution: environment → paths, app-namespaced directories, native OS conventions, and config-file resolver chains. Boundary tier: peers on `effect`, `@effected/walker` and `@effected/config-file` (plus `@effected/glob`, `@effected/jsonc`, `@effected/toml` and `@effected/yaml`, which those two bring); zero runtime deps. (The SQLite half of local state is `@effected/store`; the two compose in `@effected/app`.)

## Import

```ts
import { AppDirs, AppDirsSegmentError, NativeDirs, Xdg, XdgConfig } from "@effected/xdg";
```

Single entrypoint; no subpaths.

**Platform**: `Xdg.layer` reads only the environment; `AppDirs`' `ensure*` methods do real `mkdir -p` and need `FileSystem`/`Path` at the edge — `@effect/platform-node` or `@effect/platform-bun` (wired in the example below).

## Core API

- **`Xdg`** — `Context.Service` whose shape IS `XdgPaths` (`home`, optional `configHome`/`dataHome`/`cacheHome`/`stateHome`/`runtimeDir`, `configDirs`/`dataDirs`). `Xdg.layer` reads the real environment (fails `XdgEnvError` only when the home directory is unset: `HOME`, or on `win32` `USERPROFILE` then `HOME`, where `variable: "USERPROFILE"` means neither was set); `Xdg.layerFrom(paths)` supplies fixed values, trusted as given. **`Xdg.layerFromEnv(env)`** → `Layer<Xdg, XdgEnvError>` runs `Xdg.layer`'s resolution rule for rule over a **record** instead of the ambient environment (`""` reads as unset, as through the default provider; read when built, not at the call). Each call is a new `Layer.fresh` layer, so two calls in one graph resolve independently — which providing a `ConfigProvider` beneath the shared, memoized `Xdg.layer` does not give. To resolve from a `ConfigProvider` instead, `Layer.provide(Xdg.layer, ConfigProvider.layer(provider))`. On POSIX the home directory is `HOME` only — there is no `USERPROFILE` fallback. `CurrentPlatform` is a `Context.Reference<XdgPlatform>` defaulting to `process.platform` (`"linux"` with no `process`); `Xdg.layer`, `AppDirs.layer` and `XdgConfig.nativeResolver` all read it, so provide an override once at the edge.
- **`AppDirs`** — `Context.Service` via `AppDirs.layer({ namespace, native?, fallbackDir?, dirs? })`. `dirs: ResolvedAppDirs` resolves once at layer construction (a value, never an `Effect` — reading a path cannot fail); `ensureConfig`/`ensureData`/`ensureCache`/`ensureState`/`ensureRuntime` `mkdir -p` on demand, each `Effect<string, AppDirsError>` (`ensureRuntime` → `Option<string>`); `ensure` creates every directory the resolution has and returns the whole `ResolvedAppDirs`. Five-rung precedence: explicit override → namespaced XDG env var → native dir (only with `native: true`) → `<home>/<fallbackDir>` → `<home>/.<namespace>`. **`AppDirs.segment(name)`** → `Result<string, AppDirsSegmentError>` maps an arbitrary name (a package name, a project key) to one filesystem-safe path segment under an app directory: `/` → `__` (`@org/pkg` → `@org__pkg`), every character outside `[A-Za-z0-9._@-]` → `_`, then runs of three or more `_` collapse to `__`, matched per UTF-16 code unit (no `u` flag; a non-BMP character is `__`). The mapping is stable and **persisted** — a program finds what it stored by it — but NOT injective (`@org/pkg` and `@org__pkg` share a segment); hash the name when distinct names must never collide. It fails `AppDirsSegmentError` (`input`, `reason: "empty" | "dot" | "dot-dot"`) for a result that names no child. Pure: lift with `Effect.fromResult`. `ResolvedAppDirs` also carries `configSearchPath`/`dataSearchPath` — the full ordered lookup lists `XdgConfig.resolver` searches, not just the app's own directory.
- **`NativeDirs.resolve({ platform, namespace, paths, path })`** — pure darwin/win32 native-dir mapping; `Option.none()` elsewhere (Linux has no native override — XDG already is the native convention there).
- **`XdgConfig`** — `resolver({ filename }): ConfigResolver<AppDirs | FileSystem | Path>` (searches the app's whole XDG config search path via `Walker.firstMatch` — an unreadable candidate is skipped, not fatal), `nativeResolver({ namespace, filename }): ConfigResolver<Xdg | FileSystem | Path>` (probes the OS-native directory only), `savePath(filename): Effect<string, never, AppDirs | Path>` — these produce `@effected/config-file` `ConfigResolver` values, bridging the two packages. `savePath`'s error channel is `never` on purpose: it is the only shape that fits `ConfigFile.layer`'s `defaultPath?: Effect<string, never, RR>` slot without an `orDie`.

## Usage

```ts
import { AppDirs, Xdg } from "@effected/xdg";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, Layer } from "effect";

const AppDirsLive = AppDirs.layer({ namespace: "myapp", native: true });
const XdgLive = Layer.mergeAll(Xdg.layer, AppDirsLive.pipe(Layer.provide(Xdg.layer)));

const program = Effect.gen(function* () {
 const dirs = yield* AppDirs;
 return yield* dirs.ensureConfig; // mkdir -p — needs the platform layer
}).pipe(Effect.provide(XdgLive), Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)));
```

Bridging into `@effected/config-file` — `XdgConfig` produces `ConfigResolver` values directly:

```ts
import { XdgConfig } from "@effected/xdg";
import { ConfigFile, JsonCodec, MergeStrategy } from "@effected/config-file";
import { Effect, Schema } from "effect";

class AppShape extends Schema.Class<AppShape>("AppShape")({ port: Schema.Number }) {}
class AppConfigTag extends ConfigFile.Service<AppConfigTag, AppShape>()("myapp/Config") {}

const AppConfigLive = ConfigFile.layer(AppConfigTag, {
 schema: AppShape,
 codec: JsonCodec,
 resolvers: [XdgConfig.resolver({ filename: "config.json" }), XdgConfig.nativeResolver({ namespace: "myapp", filename: "config.json" })],
 strategy: MergeStrategy.firstMatch(),
 defaultPath: XdgConfig.savePath("config.json"), // `never` error channel — fits without an `orDie`
});
```

## Testing machinery

None exported, but the pattern is fully supported by the API: pin the environment with `Xdg.layerFromEnv({ HOME: "/home/test", ... })` (or `ConfigProvider.layer(...)` beneath `Xdg.layer`), pin the platform with `Layer.succeed(CurrentPlatform, "win32")`, and use `Xdg.layerFrom(XdgPaths.make({...}))` for fixed paths. No platform package needed.

## Gotchas

- Fallback rungs 4/5 are deliberately NOT the XDG spec defaults (`~/.config`, `~/.local/share`) — pass `dirs` overrides if you want spec defaults.
- A **relative** `XDG_*` value is ignored, per the XDG spec: it reads as an absent key, so resolution falls to the next rung instead of a directory under the cwd. `XDG_*` values are judged by the platform's absolute rule; `APPDATA`/`LOCALAPPDATA` always by the Windows rule (`C:\x`, `\x` or `/x`). Relative `*_DIRS` entries are dropped, and a list left empty takes the spec default, as an empty variable does. The home directory is deliberately not validated, and a missing one fails `Xdg.layer` eagerly even when every `XDG_*_HOME` is set.
- On `win32`, `XDG_CONFIG_DIRS`/`XDG_DATA_DIRS` split on `;`, not `:` — a `:` split would cut a drive letter off.
- xdg does not build on core's `UserDirectories` (`effect/persistence`, `@stability unstable`): core folds the XDG variable and the native directory into one answer per kind and has no search paths or runtime directory, and its Linux default is the spec layout where xdg's is `~/.<ns>`. They agree on absolute `XDG_*_HOME` values and on darwin/win32 native directories.
- The runtime directory has no fallback ladder: override, `$XDG_RUNTIME_DIR`, or absent — never invented.
- `NativeDirs.resolve` is `Option.none()` on Linux by design (XDG is native there).
- A namespace containing `/`, `\`, `..`, or empty is a defect at layer construction, not a typed error. A runtime-derived name goes through `AppDirs.segment`, whose failure IS typed.
- `AppDirs.segment` does not refuse a trailing `.` or a device name such as `CON`: the mapping is the same on every platform, so on Windows such a segment aliases another path.
