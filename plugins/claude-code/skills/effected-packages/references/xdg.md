# @effected/xdg

XDG Base Directory resolution: environment → paths, app-namespaced directories, native OS conventions, and config-file resolver chains. Boundary tier: peers on `effect`, `@effected/walker` and `@effected/config-file`; zero runtime deps. (The SQLite half of local state is `@effected/store`; the two compose in `@effected/app`.)

## Import

```ts
import { AppDirs, NativeDirs, Xdg, XdgConfig } from "@effected/xdg";
```

Single entrypoint; no subpaths.

**Platform**: `Xdg.layer` reads only the environment; `AppDirs`' `ensure*` methods do real `mkdir -p` and need `FileSystem`/`Path` at the edge — `@effect/platform-node` or `@effect/platform-bun` (wired in the example below).

## Core API

- **`Xdg`** — `Context.Service` whose shape IS `XdgPaths` (`home`, optional `configHome`/`dataHome`/`cacheHome`/`stateHome`/`runtimeDir`, `configDirs`/`dataDirs`). `Xdg.layer` reads the real environment (fails `XdgEnvError` only when `HOME` is unset); `Xdg.layerFrom(paths)` supplies fixed values. `CurrentPlatform` is a `Context.Reference<XdgPlatform>` defaulting to `process.platform`.
- **`AppDirs`** — `Context.Service` via `AppDirs.layer({ namespace, native?, fallbackDir?, dirs? })`. `dirs: ResolvedAppDirs` resolves once at layer construction (a value, never an `Effect` — reading a path cannot fail); `ensureConfig`/`ensureData`/`ensureCache`/`ensureState`/`ensureRuntime` `mkdir -p` on demand, each `Effect<string, AppDirsError>` (`ensureRuntime` → `Option<string>`); `ensure` creates every directory the resolution has and returns the whole `ResolvedAppDirs`. Five-rung precedence: explicit override → namespaced XDG env var → native dir (only with `native: true`) → `$HOME/<fallbackDir>` → `$HOME/.<namespace>`. `ResolvedAppDirs` also carries `configSearchPath`/`dataSearchPath` — the full ordered lookup lists `XdgConfig.resolver` searches, not just the app's own directory.
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

None exported, but the pattern is fully supported by the API: pin the environment with `ConfigProvider.layer(ConfigProvider.fromUnknown({...}))`, pin the platform with `Layer.succeed(CurrentPlatform, "win32")`, and use `Xdg.layerFrom(XdgPaths.make({...}))` for fixed paths. No platform package needed.

## Gotchas

- Fallback rungs 4/5 are deliberately NOT the XDG spec defaults (`~/.config`, `~/.local/share`) — pass `dirs` overrides if you want spec defaults.
- The runtime directory has no fallback ladder: override, `$XDG_RUNTIME_DIR`, or absent — never invented.
- `NativeDirs.resolve` is `Option.none()` on Linux by design (XDG is native there).
- A namespace containing `/`, `\`, `..`, or empty is a defect at layer construction, not a typed error.
