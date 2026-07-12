---
"@effected/app": minor
---

## Features

Initial release of `@effected/app` — the application control plane: one layer wiring XDG-namespaced directories, a migrated SQLite `Store` and a TTL `Cache` to the same place. It is the final package in the kit, a thin composition over `@effected/xdg`, `@effected/store` and `@effected/config-file` with no domain logic, no service and no schema of its own:

```ts
import { App } from "@effected/app";
import { Cache, Store } from "@effected/store";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Layer, Path } from "effect";

const AppLayer = App.layer({
  namespace: "myapp",
  store: { migrations: [{ id: 1, name: "create-notes", up: (sql) => sql`CREATE TABLE notes (body TEXT)` }] },
});

const program = Effect.gen(function* () {
  const store = yield* Store;
  const cache = yield* Cache;
  yield* store.client`INSERT INTO notes (body) VALUES ('hello')`;
}).pipe(Effect.provide(Layer.mergeAll(AppLayer, NodeFileSystem.layer, Path.layer)));
```

### App — the composed control plane

`App.layer(options)` resolves the namespaced XDG directories, then opens `store.db` in the state directory and `cache.db` in the cache directory, always creating each parent directory before the database is opened — `SqliteClient.layer` defects on a missing directory, so the ensure step runs first and converts that into a typed, recoverable failure instead. `App.layer` always provides both databases; an application that wants only one composes `AppStore.layer` or `AppCache.layer` directly. `App.layerTest({ namespace })` is a hermetic in-memory control plane over synthetic XDG paths and `:memory:` databases, needing no platform layers at all — a consumer's first test is one line.

### AppStore and AppCache — the individual glue layers

`AppStore.layer(options)` and `AppCache.layer(options)` are the same ensure-then-open composition for just the state or just the cache database, each defaulting its filename (`store.db`, `cache.db`) and validating it as a single path component.

### AppConfig — the XDG-flavored config preset

`AppConfig.layer(tag, { filename, schema, codec })` wires a `ConfigFile` service over `@effected/xdg`'s resolver chain (XDG search path, then the OS-native directory), with `defaultPath` pointed at the app's own config directory. The namespace is never a parameter here — it is read from the ambient `AppDirs` service at layer build time, so it is declared exactly once, in `App.layer`, and can't drift between the database directories and the config search path.

### AppError

A type-only union — `XdgEnvError | AppDirsError | StoreError | StoreMigrationError | CacheError` — for the application edge's `catchTags` block. It costs nothing at runtime and introduces no new error model; every constituent error flows through unwrapped.

Nothing may depend on `@effected/app`: it is the kit's application-tier composition, one level past the library boundary the other sixteen packages hold.
