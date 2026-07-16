# @effected/app

The application control plane: one composition layer wiring XDG-namespaced directories, a migrated SQLite `Store`, a TTL `Cache` and a config file to the same place. A thin composition over `xdg` + `store` + `config-file` with no domain logic of its own. Integrated tier (inherited from `store`).

**The rule: nothing may depend on `@effected/app`.** It is for applications only — a library taking the control plane as a dependency drags integrated tier into every consumer. Libraries compose the underlying packages directly.

## Import

```ts
import { App, AppCache, AppConfig, AppStore } from "@effected/app";
```

Single entrypoint; exactly four value exports (plus their option types and the `AppError` type alias), nothing re-exported from beneath — if you only want config files, import `@effected/config-file` directly.

**Platform**: `App.layer` requires `FileSystem` and `Path` at the edge — `@effect/platform-node`'s `NodeServices.layer` (as in the example) or `NodeFileSystem.layer` + `NodePath.layer`, or the `@effect/platform-bun` equivalents. `App.layerTest` requires nothing (`R = never`).

## Core API

- **`App.layer(options)`** → `Layer<Xdg | AppDirs | Store | Cache, AppError, FileSystem | Path>` — wires all four services from a namespace + `store` (migrations, required) + `cache` options. Always opens BOTH databases.
- **`App.layerTest(options)`** — same services with `R = never`: synthetic XDG paths, `:memory:` databases, `FileSystem.layerNoop` internally.
- **`AppStore.layer(options)` / `AppCache.layer(options)`** — the state-dir / cache-dir SQLite glue alone (`R = AppDirs | Path`).
- **`AppConfig.layer(tag, options)`** — the XDG-flavored `ConfigFile.layer` preset. Requires an explicit `codec`; takes NO `namespace` parameter — it reads the namespace from the ambient `AppDirs` service so the two can never drift.

## Usage

```ts
import { App, AppConfig } from "@effected/app";
import { ConfigFile, JsonCodec } from "@effected/config-file";
import { Store } from "@effected/store";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Layer, Schema } from "effect";

class Settings extends Schema.Class<Settings>("Settings")({ registry: Schema.String }) {}
class SettingsFile extends ConfigFile.Service<SettingsFile, Settings>()("myapp/Settings") {}

// Bind once — calling App.layer twice opens two databases.
const AppLive = App.layer({ namespace: "myapp", store: { migrations: [] }, cache: { maxEntries: 500 } });
const ConfigLive = AppConfig.layer(SettingsFile, { filename: "config.json", schema: Settings, codec: JsonCodec });
const MainLive = ConfigLive.pipe(Layer.provideMerge(AppLive), Layer.provide(NodeServices.layer));

const main = Effect.gen(function* () {
 const store = yield* Store;
 yield* store.client`INSERT INTO runs (id) VALUES (${crypto.randomUUID()})`;
});

NodeRuntime.runMain(main.pipe(Effect.provide(MainLive)));
```

## Testing machinery

**`App.layerTest(options)`** is exported for consumer suites: `R = never`, no platform package needed. Known limit: it stubs the filesystem, so code paths calling `ensure*` directory creation die against the noop fs — use `App.layer` with a temp-directory `HOME` to exercise real directory behavior.

## Gotchas

- The memoization trap at maximum cost: every export is a parameterized layer factory — inline calls at two provide sites open duplicate databases with split event streams. Bind each layer once.
- Never pass a namespace to `AppConfig` — it comes solely from `AppDirs` via `App.layer`.
- `filename` options must be a single path component — `.` and `..` die at construction.
- `AppError` is a type-only union alias (`XdgEnvError | AppDirsError | StoreError | StoreMigrationError | CacheError`) for `catchTags` convenience — constituent errors flow through unwrapped.
- No `App`-level spans exist deliberately — every fallible op is already spanned by its owning package.
