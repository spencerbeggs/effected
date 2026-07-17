# @effected/xdg

## 0.1.1

### Dependencies

| Dependency            | Type       | Action  | From  | To    |
| --------------------- | ---------- | ------- | ----- | ----- |
| @effected/config-file | dependency | updated | 0.1.0 | 0.1.1 |
| @effected/walker      | dependency | updated | 0.1.0 | 0.2.0 |

## 0.1.0

### Features

* XDG Base Directory resolution for Effect. `Xdg` reads the environment — `$HOME`, the four `*_HOME` variables, `$XDG_RUNTIME_DIR`, and the `$XDG_CONFIG_DIRS` / `$XDG_DATA_DIRS` search paths — once, at layer construction, so a resolved path is a `string`, not an `Effect`. `AppDirs` turns that into the config, data, cache, state and runtime directories for one application namespace, with on-demand creation. `NativeDirs` supplies the macOS and Windows conventions, and `XdgConfig` plugs the whole thing into `@effected/config-file` as a resolver chain and a save target.

  ### App directories for a namespace

  Build `AppDirs` for your namespace, provide it the `Xdg` environment and the platform layers, and read the paths. Each of `config`, `data`, `cache` and `state` resolves through a five-rung precedence (explicit override → namespaced XDG var → native dir → `$HOME/<fallbackDir>` → `$HOME/.<namespace>`), first match wins.

  ```ts
  import { AppDirs, Xdg } from "@effected/xdg";
  import { NodeFileSystem, NodePath } from "@effect/platform-node";
  import { Effect, Layer } from "effect";

  const PlatformLive = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

  const AppDirsLive = AppDirs.layer({ namespace: "myapp", native: true }).pipe(
    Layer.provide(Layer.mergeAll(Xdg.layer, PlatformLive)),
  );

  const program = Effect.gen(function* () {
    const appDirs = yield* AppDirs;
    console.log(appDirs.dirs.config); // e.g. $XDG_CONFIG_HOME/myapp
    return yield* appDirs.ensureConfig; // the same path, now created on disk
  });

  Effect.runPromise(program.pipe(Effect.provide(AppDirsLive)));
  ```

  `AppDirs.layer` is a layer-returning function — bind its result to a const and provide that.

  ### Config-file bridge

  `XdgConfig` drops straight into `@effected/config-file`: `resolver` searches the app's whole config search path, `nativeResolver` probes the OS-native directory, and `savePath` names the default write target — the latter with a `never` error channel that fits the `defaultPath` slot without an `orDie`.

  ```ts
  import { ConfigFile, JsonCodec, MergeStrategy } from "@effected/config-file";
  import { XdgConfig } from "@effected/xdg";
  import { Schema } from "effect";

  class AppShape extends Schema.Class<AppShape>("AppShape")({
    port: Schema.Number,
    host: Schema.String,
  }) {}

  class AppConfig extends ConfigFile.Service<AppConfig, AppShape>()("myapp/Config") {}

  export const AppConfigLive = ConfigFile.layer(AppConfig, {
    schema: AppShape,
    codec: JsonCodec,
    resolvers: [
      XdgConfig.resolver({ filename: "config.json" }),
      XdgConfig.nativeResolver({ namespace: "myapp", filename: "config.json" }),
    ],
    strategy: MergeStrategy.firstMatch<AppShape>(),
    defaultPath: XdgConfig.savePath("config.json"),
  });
  ```

  `NativeDirs.resolve` is pure — platform, namespace, environment and `Path` all arrive as parameters — and `CurrentPlatform` is a `Context.Reference`, so the whole darwin/win32 matrix is testable with no filesystem. Failures are the two tagged errors `XdgEnvError` (`$HOME` unset) and `AppDirsError` (a directory could not be created). [#81][#81]

### Dependencies

| Dependency            | Type       | Action  | From  | To    |
| --------------------- | ---------- | ------- | ----- | ----- |
| @effected/config-file | dependency | updated | 0.0.0 | 0.1.0 |
| @effected/walker      | dependency | updated | 0.0.0 | 0.1.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#81]: https://github.com/spencerbeggs/effected/pull/81
