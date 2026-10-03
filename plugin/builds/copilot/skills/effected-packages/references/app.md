# @effected/app

The application control plane: one composition layer wiring XDG-namespaced directories, a migrated SQLite `Store`, a TTL `Cache` and a config file to the same place. A thin composition over `xdg` + `store` + `config-file` with no domain logic of its own. Integrated tier (inherited from `store`).

**The rule: no library or package may depend on `@effected/app`** — the application at the top of the graph is exactly what's meant to provide and use it, so "nothing may depend on it" bars *other libraries*, not the application itself. A library taking the control plane as a dependency drags integrated tier into every consumer; libraries compose the underlying packages directly. If you're building the app, `@effected/app` is precisely your control plane — reach for it.

## Import

```ts
import { App, AppCache, AppConfig, AppStore } from "@effected/app";
```

Single entrypoint; exactly four value exports (plus their option types and the `AppError` type alias), nothing re-exported from beneath — if you only want config files, import `@effected/config-file` directly.

**Platform**: `App.layer` requires `FileSystem` and `Path` at the edge — `@effect/platform-node`'s `NodeServices.layer` (as in the example) or `NodeFileSystem.layer` + `NodePath.layer`, or the `@effect/platform-bun` equivalents. `App.layerTest` requires nothing (`R = never`).

## Core API

- **`App.layer(options)`** → `Layer<Xdg | AppDirs | Store | Cache, AppError, FileSystem | Path>` — wires all four services from a namespace + `store` (migrations, required) + `cache` options. Building it opens and migrates BOTH databases eagerly, used or not — right for a service, wrong at a CLI's entry point (see "CLIs" below).
- **`App.layerDirs(options)`** → `Layer<Xdg | AppDirs, XdgEnvError, FileSystem | Path>` — the directories half alone (`AppDirsOptions` pass-through); opens no database. `App.layer` is built on it. Its output satisfies the `AppDirs` requirement of every `AppStore` / `AppCache` / `AppConfig` layer.
- **`App.layerTest(options)`** — same services with `R = never`: synthetic XDG paths, `:memory:` databases, `FileSystem.layerNoop` internally.
- **`AppStore.layer(options)` / `AppCache.layer(options)`** — the SQLite glue alone (`R = AppDirs | Path | FileSystem`). Location: `directory: "state" | "data" | "cache"` (default state for stores, cache for caches) plus an optional relative `subdir` created `mkdir -p` before open (`{ directory: "data", subdir: projectKey, filename: "data.db" }`); a failed subdir mkdir is a typed `AppDirsError`. Everything else is `@effected/store`'s, passed through: `client` (`busyTimeout`, `disableWAL` — per-connection settings go here, never in a migration), `checkpointOnClose`, and `adoptMigratorLedger` (stores: move a database migrated by effect/sql's `Migrator` without re-running it). `onConnect`, `mirrorMigratorLedger` pass through too. **`AppStore.location(options)` / `AppCache.location(options?)`** → `Effect<string, never, AppDirs | Path>` resolves the absolute file path the layer would open — same derivation, nothing created — for reporting or persisting it. Absolute / host-chosen paths are NOT app options — use `Store.layerSqliteAs` / `Cache.layerSqliteAs` from `@effected/store`.
- **`AppStore.layerAs(tag, options)` / `AppCache.layerAs(tag, options)`** → `Layer<I, …, AppDirs | Path | FileSystem>` — an ADDITIONAL database under a service key you define: `class RegistryStore extends Context.Service<RegistryStore, StoreShape>()("myapp/RegistryStore") {}` (`StoreShape` / `CacheShape` from `@effected/store`). Same default directory as the primary (or its own `directory` / `subdir`), own file, own migrations and ledger; outputs only your key (the inner `Store` / `Cache` never leaks, so it sits beside the primary). `filename` is REQUIRED — a default would land on the primary's `store.db` / `cache.db`. The key's service type must be the shape: an incompatible shape or one that adds members (`StoreShape & { … }`, reported as "not assignable to parameter of type 'never'") is a compile error; a member redeclared as a method with a wider parameter still compiles (method bivariance).
- **`AppConfig.layer(tag, options)`** — the XDG-flavored `ConfigFile.layer` preset: `{ filename, schema, codec, strategy?, validate?, events?, native? }`. Requires an explicit `codec` (never defaulted or inferred from `filename`'s extension — that would hard-code a format choice into a composition layer); takes NO `namespace` parameter — it reads the namespace from the ambient `AppDirs` service so the two can never drift. `native` (default `true`) probes the OS-native config directory as a fallback, after the XDG resolver — pass `false` to drop it. **`resolvers?`** prepends caller resolvers AHEAD of the XDG chain — this is how a CLI's `--config` flag outranks the app's own search path (`ConfigResolver.explicitPath` for a file, `staticDir` for a directory); absent, the chain is unchanged. A prepended resolver that finds nothing **falls through** to XDG (every resolver's error channel is `never` by contract, so a `--config` naming a missing file is a miss, not an error — guard it yourself before building the layer), and the save path is unaffected. **`parseOptions?`** threads `SchemaAST.ParseOptions` into every decode, chiefly `onExcessProperty: "error"` so a typo'd section or a removed field is reported instead of silently dropped; pair it with `errors: "all"` or a file with three typos surfaces one per run. Reaches only `@effected/xdg` + `@effected/config-file`, never the SQLite driver, so a consumer wanting XDG-placed config alone imports `AppConfig` without pulling a database into their graph. The `tag` is a `ConfigFile.Service` key: one whose shape adds members to `ConfigFileShape<A>` is a compile error ("not assignable to parameter of type 'never'"), with the same method-bivariance limit as `layerAs`.

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

## CLIs: directories everywhere, databases per command

Provide `App.layerDirs` once at `CliRuntime.main`, bind each database layer once at module scope, and attach it with `Command.provide` only on the commands that use it — otherwise every command (help paths included) creates and migrates both files, and a command that deletes the app's files deletes a database its own process holds open.

```ts
import { App, AppStore } from "@effected/app";
import { CliRuntime } from "@effected/cli";
import { Store } from "@effected/store";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { Command } from "effect/cli";

const StoreLive = AppStore.layer({ migrations }); // module scope, bound once

const history = Command.make("history", {}, () =>
  Effect.gen(function* () {
    const store = yield* Store;
    yield* store.client`SELECT id FROM runs`;
  }),
).pipe(Command.provide(StoreLive)); // store.db opens only when `history` runs

const cli = Command.make("myapp").pipe(Command.withSubcommands([history]));
const PlatformLive = App.layerDirs({ namespace: "myapp" }).pipe(Layer.provideMerge(NodeServices.layer));

NodeRuntime.runMain(CliRuntime.main(Command.run(cli, { version: "1.0.0" }), { platform: PlatformLive }));
```

`Command.provide` also takes `(input) => Layer` for a database whose options depend on a flag; keep anything input-independent bound outside that function. Keyed `layerAs` layers slot into the same shape unchanged. A module-scope binding (`StoreLive`) stays ONE connection however many composites reuse it inside one provided layer graph (`Layer.mergeAll(StoreLive, …)` beside `X.pipe(Layer.provide(StoreLive))`), and an `Effect.provide` nested inside another reuses what the enclosing one built — but provides that are NOT nested (sequential, or siblings under a common parent) each build it again.

## Testing machinery

**`App.layerTest(options)`** is exported for consumer suites: `R = never`, no platform package needed. Known limit: it stubs the filesystem, so code paths calling `ensure*` directory creation die against the noop fs. Test real directory behaviour (`ensure*`, `subdir` creation, `location`) by composing `App.layerDirs` / `AppDirs.layer` over `@effected/memfs`. The databases cannot follow there: `Store`/`Cache` open SQLite files through the native binding, which never sees the `FileSystem` service, so an end-to-end database test runs against a temp-directory `HOME` on the real filesystem.

## Gotchas

- The memoization trap at maximum cost: every export is a parameterized layer factory — inline calls at two provide sites open duplicate databases with split event streams. Bind each layer once, including every `layerAs(…)`: two inline calls with the same key open the file twice.
- N named stores are N bound `layerAs` constants — there is no `App.layer({ stores })` map, by design (it would open every store eagerly).
- Never pass a namespace to `AppConfig` — it comes solely from `AppDirs` via `App.layer`.
- `filename` options (including `layerAs`'s) must be a single path component — `.` and `..` die at construction. A `subdir` must be relative with every component obeying the same rule. Both DIE on a bad value (wiring, not input), so a runtime-derived subdir must come from a sanitised derivation — hash it: `createHash("sha256").update(projectRoot).digest("hex").slice(0, 16)`.
- `AppError` is a type-only union alias (`XdgEnvError | AppDirsError | StoreError | StoreMigrationError | CacheError`) for `catchTags` convenience — constituent errors flow through unwrapped.
- No `App`-level spans exist deliberately — every fallible op is already spanned by its owning package.
