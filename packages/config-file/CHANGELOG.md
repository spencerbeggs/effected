# @effected/config-file

## 0.1.5

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/toml   | dependency | updated | 0.2.0 | 0.3.0 |
| @effected/walker | dependency | updated | 0.2.2 | 0.3.0 |
| @effected/yaml   | dependency | updated | 0.4.0 | 0.5.0 |

## 0.1.4

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/jsonc  | dependency | updated | 0.3.0 | 0.4.0 |
| @effected/toml   | dependency | updated | 0.1.0 | 0.2.0 |
| @effected/walker | dependency | updated | 0.2.1 | 0.2.2 |
| @effected/yaml   | dependency | updated | 0.3.1 | 0.4.0 |

* | Dependency | Type           | Action  | From          | To            |                                                                       |
  | ---------- | -------------- | ------- | ------------- | ------------- | --------------------------------------------------------------------- |
  | effect     | peerDependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 | [#122][#122] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#122]: https://github.com/spencerbeggs/effected/pull/122

## 0.1.3

### Dependencies

| Dependency      | Type       | Action  | From  | To    |
| --------------- | ---------- | ------- | ----- | ----- |
| @effected/jsonc | dependency | updated | 0.2.0 | 0.3.0 |
| @effected/yaml  | dependency | updated | 0.3.0 | 0.3.1 |

## 0.1.2

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/walker | dependency | updated | 0.2.0 | 0.2.1 |
| @effected/yaml   | dependency | updated | 0.2.0 | 0.3.0 |

## 0.1.1

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/jsonc  | dependency | updated | 0.1.0 | 0.2.0 |
| @effected/walker | dependency | updated | 0.1.0 | 0.2.0 |
| @effected/yaml   | dependency | updated | 0.1.0 | 0.2.0 |

## 0.1.0

### Features

* Composable config file loading for Effect. Declare a resolver chain — an explicit path, an upward walk from the cwd, the workspace or git root, `/etc` — decode every discovered file through an Effect `Schema`, and combine the results with a merge strategy. JSON, JSONC, YAML and TOML all decode out of the box from a single install. Discovery, reading, parsing, validation and persistence each fail with their own tagged error carrying its cause structurally, so "no config anywhere" is routable separately from "the config I found is broken". Zero external runtime dependencies.

  ### Codec × resolver × strategy

  Declare a schema, mint a service class for it with `ConfigFile.Service`, and build its live layer with `ConfigFile.layer` from a codec, a resolver chain and a merge strategy. Resolvers are consulted in priority order; `MergeStrategy.firstMatch` takes the winner, `MergeStrategy.layeredMerge` deep-merges every source that matched.

  ```ts
  import { ConfigFile, ConfigResolver, JsonCodec, MergeStrategy } from "@effected/config-file";
  import { NodeFileSystem, NodePath } from "@effect/platform-node";
  import { Effect, Layer, Schema } from "effect";

  class AppShape extends Schema.Class<AppShape>("AppShape")({
    port: Schema.Number,
    host: Schema.String,
  }) {}

  class AppConfig extends ConfigFile.Service<AppConfig, AppShape>()("app/Config") {}

  const AppConfigLive = ConfigFile.layer(AppConfig, {
    schema: AppShape,
    codec: JsonCodec,
    resolvers: [ConfigResolver.upwardWalk({ filename: ".apprc" })],
    strategy: MergeStrategy.firstMatch<AppShape>(),
  });

  const program = Effect.gen(function* () {
    const config = yield* AppConfig;
    return yield* config.load;
  });

  const PlatformLive = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

  Effect.runPromise(program.pipe(Effect.provide(AppConfigLive), Effect.provide(PlatformLive))).then(console.log);
  // AppShape { port: 3000, host: "localhost" }
  ```

  `ConfigFile.layer` is a layer-returning function — bind its result to a const and provide that.

  ### Four free-standing codecs, tree-shaken

  The four codecs — `JsonCodec`, `JsoncCodec`, `YamlCodec`, `TomlCodec` — are free-standing named exports, never a namespace object, so importing `TomlCodec` never references the YAML or JSONC bindings and a bundler drops the parsers you do not name. A JSON-only application ships no parser at all. Codecs compose: `EncryptedCodec` wraps any codec with AES-GCM and `ConfigMigration.make` brings parsed content up to the latest version, each *widening* the error channel rather than flattening it.

  ```ts
  import { ConfigMigration, EncryptedCodec, EncryptedCodecKey, JsonCodec } from "@effected/config-file";
  import { Effect } from "effect";

  const migrating = ConfigMigration.make({
    codec: JsonCodec,
    migrations: [
      {
        version: 2,
        name: "add-port",
        up: (raw) => Effect.succeed({ ...(raw as Record<string, unknown>), port: 8080 }),
      },
    ],
  });

  export const secret = EncryptedCodec(migrating, EncryptedCodecKey.fromPassphrase("hunter2", new Uint8Array(16)));
  ```

  ### Tagged errors and a ConfigProvider bridge

  Eight tagged errors (`ConfigFileNotFoundError`, `ConfigValidationError` with the schema issue tree, `ConfigCodecError`, `ConfigMigrationError`, `ConfigEncryptionError` and more) route with `Effect.catchTag`, and per-method unions (`ConfigLoadError`, `ConfigReadError`, …) name exactly what each method can produce. `asConfigProvider` / `layerConfigProvider` expose a loaded, validated document as a v4 `ConfigProvider` layered beneath the ambient one, and `ConfigEvents` is an opt-in `PubSub` that is honestly zero-cost when omitted. [#81][#81]

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/jsonc  | dependency | updated | 0.0.0 | 0.1.0 |
| @effected/toml   | dependency | updated | 0.0.0 | 0.1.0 |
| @effected/walker | dependency | updated | 0.0.0 | 0.1.0 |
| @effected/yaml   | dependency | updated | 0.0.0 | 0.1.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#81]: https://github.com/spencerbeggs/effected/pull/81
