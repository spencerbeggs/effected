---
"@effected/xdg": minor
---

## Features

Initial release of `@effected/xdg` — XDG Base Directory resolution for [Effect](https://effect.website) v4, ported from `xdg-effect` and redesigned around a single idea: turn the environment into paths, once. It is the XDG half of the `xdg-effect` split; the SQLite services shipped separately as `@effected/store`, and this package does not depend on them.

```ts
import { AppDirs, Xdg, XdgConfig } from "@effected/xdg";
import { ConfigFile, JsonCodec, MergeStrategy } from "@effected/config-file";
import { Effect, Layer } from "effect";

const XdgLayer = Layer.mergeAll(
  Xdg.layer,
  AppDirs.layer({ namespace: "myapp", native: true }).pipe(Layer.provide(Xdg.layer)),
);

const ConfigLayer = ConfigFile.layer(AppConfig, {
  schema: AppShape,
  codec: JsonCodec,
  strategy: MergeStrategy.firstMatch<AppShape>(),
  resolvers: [
    XdgConfig.resolver({ filename: "config.json" }),
    XdgConfig.nativeResolver({ namespace: "myapp", filename: "config.json" }),
  ],
  defaultPath: XdgConfig.savePath("config.json"),
});

const program = Effect.gen(function* () {
  const appDirs = yield* AppDirs;
  appDirs.dirs.config; // a string — reading a path cannot fail
  yield* appDirs.ensureCache; // creates it, or fails with AppDirsError
});
```

### Resolution happens once, at layer construction

`Xdg`'s service shape **is** the resolved `XdgPaths`, and `AppDirs.dirs` is a plain value rather than an `Effect`. The environment is fixed when the layer is built, so that is where it is read. Reading a path therefore cannot fail, and the only fallible members are the `ensure*` operations that actually touch the filesystem. The one environment failure — an unset `HOME` — surfaces once, on `Xdg.layer`, as a typed `XdgEnvError`.

This is what gives `XdgConfig.savePath` the infallible error channel that `ConfigFile.defaultPath` requires. The v3 library re-read the environment on every property access, so the same composition was only reachable by laundering the failure into a defect.

### The platform is injected, not read from a global

`CurrentPlatform` is a `Context.Reference` defaulting to `process.platform`, and `NativeDirs.resolve` is a pure function over it. The macOS and Windows directory conventions (`~/Library/Application Support`, `%APPDATA%`, `%LOCALAPPDATA%`, and the `AppData/Roaming` fallback when the variables are unset) are therefore exercised in full without any platform IO — a test pins a platform with `Layer.succeed(CurrentPlatform, "win32")`.

### The XDG search path, and a bug it fixed

`XDG_CONFIG_DIRS` and `XDG_DATA_DIRS` are modeled for the first time, so a config lookup searches the app's own directory and then each system directory in order, rather than stat-ing a single path. The search runs through `@effected/walker`'s `firstMatch`, which absorbs a failure **per candidate**. The v3 resolver absorbed at whole-resolver granularity, so a single unreadable directory reported "not found" and hid a perfectly readable config behind it.

### Redesigned errors and a namespace guard

The four `reason: string` errors collapse to two tagged classes — `XdgEnvError` and `AppDirsError` — each carrying its underlying failure structurally in `cause`, with `AppDirsError` naming the directory kind and path that failed. A namespace that is empty or contains a path separator is now a defect at layer construction; v3 accepted `"../.."` and resolved the application's directories outside `$HOME`.

The `Live` preset family (`XdgLive`, `XdgConfigLive`, `XdgFullLive` and the format-specific factories) is not ported: with layers co-located and memoized by reference, composition at the consumer's edge is clearer than a grab-bag, and the format choice is no longer this package's to make.
