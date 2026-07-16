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
- **`AppDirs`** — `Context.Service` via `AppDirs.layer({ namespace, native?, fallbackDir?, dirs? })`. `dirs` resolves once at layer construction; `ensureConfig`/`ensureData`/`ensureCache`/`ensureState`/`ensureRuntime` `mkdir -p` on demand, each `Effect<string, AppDirsError>` (`ensureRuntime` → `Option<string>`). Five-rung precedence: explicit override → namespaced XDG env var → native dir (only with `native: true`) → `$HOME/<fallbackDir>` → `$HOME/.<namespace>`.
- **`NativeDirs.resolve({ platform, namespace, paths, path })`** — pure darwin/win32 native-dir mapping; `Option.none()` elsewhere.
- **`XdgConfig`** — `resolver({ filename })` (search the XDG config path), `nativeResolver({ namespace, filename })`, `savePath(filename)` — these produce `@effected/config-file` `ConfigResolver` values, bridging the two packages.

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

## Testing machinery

None exported, but the pattern is fully supported by the API: pin the environment with `ConfigProvider.layer(ConfigProvider.fromUnknown({...}))`, pin the platform with `Layer.succeed(CurrentPlatform, "win32")`, and use `Xdg.layerFrom(XdgPaths.make({...}))` for fixed paths. No platform package needed.

## Gotchas

- Fallback rungs 4/5 are deliberately NOT the XDG spec defaults (`~/.config`, `~/.local/share`) — pass `dirs` overrides if you want spec defaults.
- The runtime directory has no fallback ladder: override, `$XDG_RUNTIME_DIR`, or absent — never invented.
- `NativeDirs.resolve` is `Option.none()` on Linux by design (XDG is native there).
- A namespace containing `/`, `\`, `..`, or empty is a defect at layer construction, not a typed error.
