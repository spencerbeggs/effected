---
"@effected/app": minor
---

## Breaking Changes

* `AppStore.layer` and `AppCache.layer` now require `FileSystem` in `R` even when no `subdir` is given, because they create the database's directory. Provide the platform layer alongside `App.layerDirs`.
* `AppConfig.layer` rejects a key whose service shape is wider than `ConfigFileShape` at compile time. Calls that pass the type arguments explicitly keep compiling.

## Features

### App.layerDirs

`App.layerDirs` provides `Xdg` and `AppDirs` for a namespace without opening any database. `App.layer` opens and migrates both databases as soon as it is built, so a CLI that provides it at the edge touches them on every command. Provide `App.layerDirs` once at the edge instead, bind `AppStore.layer` / `AppCache.layer` once at module scope, and attach them with `Command.provide` only on the commands that use them.

```typescript
const PlatformLive = App.layerDirs({ namespace: "myapp" }).pipe(Layer.provideMerge(NodeServices.layer));
```

### Keyed store and cache layers

`AppStore.layerAs` and `AppCache.layerAs` bind a database to your own service key, so one app can hold several independent stores. The `filename` is required, so a keyed database can never silently share the primary store's file. A key whose service shape is incompatible with `StoreShape` / `CacheShape`, or adds members to it, is a compile error; a member redeclared as a method with a wider parameter still compiles.

```typescript
const RegistryStoreLive = AppStore.layerAs(RegistryStore, {
	filename: "registry.db",
	directory: "data",
	subdir: projectKey,
	migrations: [],
});
```

### Database placement

* `directory` and `subdir` options place the database file under the app's directories. Hash a runtime-derived `subdir` before passing it.
* `AppStore.location` and `AppCache.location` resolve the database path with the same derivation the layers use, without opening it.
* `client`, `onConnect` and `checkpointOnClose` pass through to the underlying SQLite store.
