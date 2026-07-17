# @effected/app

## 0.1.1

### Documentation

* The effected plugin's skills were refreshed alongside the git surface expansion: the `effected-packages` git reference now describes the read tier plus the marked mutating tier with the correct constructor count, and `effect-v4-construct-map` records the full v4 `Cause` find family (`findFail` alongside `findError`/`findErrorOption`) with a warning that v3's `failureOption` no longer exists. The plugin versions with this package, so the patch carries those skill updates to plugin consumers. [#85][#85]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#85]: https://github.com/spencerbeggs/effected/pull/85

## 0.1.0

### Features

* The application control plane for Effect. One `App.layer` gives an application its XDG-namespaced directories, a migrated SQLite state database, a TTL cache and — through `AppConfig.layer` — a config file, all pointed at the same place, with the namespace typed exactly once. A thin composition over `@effected/xdg`, `@effected/store` and `@effected/config-file`, with no domain logic of its own.

  ### One layer for the whole control plane

  `App.layer` ensures each directory before it opens the file inside it, converting the missing-directory defect of a raw SQLite layer into a typed failure. Bind the factory to a const once — layers memoize by reference.

  ```ts
  import { App, AppConfig } from "@effected/app";
  import { ConfigFile, JsonCodec } from "@effected/config-file";
  import { Cache, Store } from "@effected/store";
  import { NodeRuntime, NodeServices } from "@effect/platform-node";
  import { Effect, Layer, Schema } from "effect";

  class Settings extends Schema.Class<Settings>("Settings")({
    registry: Schema.String,
    concurrency: Schema.Number,
  }) {}
  class SettingsFile extends ConfigFile.Service<SettingsFile, Settings>()("myapp/Settings") {}

  const migrations = [
    { id: 1, name: "runs", up: (sql) => sql`CREATE TABLE runs (id TEXT PRIMARY KEY, at TEXT)` },
  ];

  const AppLive = App.layer({ namespace: "myapp", store: { migrations }, cache: { maxEntries: 500 } });
  const ConfigLive = AppConfig.layer(SettingsFile, { filename: "config.json", schema: Settings, codec: JsonCodec });

  const MainLive = ConfigLive.pipe(
    Layer.provideMerge(AppLive),
    Layer.provide(NodeServices.layer), // the one place a platform is named
  );

  const main = Effect.gen(function* () {
    const settings = yield* (yield* SettingsFile).load;
    const store = yield* Store;
    const cache = yield* Cache;
    yield* store.client`INSERT INTO runs (id, at) VALUES (${crypto.randomUUID()}, datetime())`;
    yield* cache.set({ key: "last-registry", value: new TextEncoder().encode(settings.registry) });
  });

  NodeRuntime.runMain(main.pipe(Effect.provide(MainLive)));
  ```

  ### Hermetic tests with no platform package

  `App.layerTest` provides the same four services over synthetic XDG paths and `:memory:` databases, with the platform layers supplied internally — a consumer's first test needs no platform import at all.

  ```ts
  import { App } from "@effected/app";
  import { layer } from "@effect/vitest";
  import { Effect } from "effect";

  layer(App.layerTest({ namespace: "myapp" }))("app", (it) => {
    it.effect("stores state", () =>
      Effect.gen(function* () {
        // Store and Cache are here, in memory, hermetic.
      }));
  });
  ```

  `AppStore.layer` and `AppCache.layer` compose the state and cache databases on their own, `AppConfig.layer` wires config files without reaching a database, and `AppError` is the type-only union for the `catchTags` block at the application edge. [#81][#81]

### Dependencies

| Dependency            | Type       | Action  | From  | To    |
| --------------------- | ---------- | ------- | ----- | ----- |
| @effected/config-file | dependency | updated | 0.0.0 | 0.1.0 |
| @effected/store       | dependency | updated | 0.0.0 | 0.1.0 |
| @effected/xdg         | dependency | updated | 0.0.0 | 0.1.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#81]: https://github.com/spencerbeggs/effected/pull/81
