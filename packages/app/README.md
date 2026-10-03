# @effected/app

[![npm](https://img.shields.io/npm/v/@effected%2Fapp?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/app)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

The application control plane for Effect. `App.layer` gives an application its XDG-namespaced directories, a migrated SQLite state database, a TTL cache and — through `AppConfig.layer` — a config file, all pointed at the same place, with the namespace typed exactly once. It is a composition over [`@effected/xdg`](../xdg), [`@effected/store`](../store) and [`@effected/config-file`](../config-file), and nothing else.

> **Pre-`1.0.0`.** This package is part of the `@effected/*` kit, built on stable
> Effect v4 (`effect` `^4.0.0`) and still in `0.x` development. Stable Effect
> makes a kit `1.0.0` possible, not automatic. To keep your `effect` and
> `@effect/*` versions on the line the kit is built and tested against, install
> [`@effected/pnpm-plugin-effect`](https://www.npmjs.com/package/@effected/pnpm-plugin-effect).
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version — even a
> package marked *stable* before `1.0.0` can introduce a breaking change by
> accident, and an exact pin turns that into a type-check error rather than a
> runtime surprise. Full policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Why @effected/app

Every application built on this kit writes the same forty lines of wiring, and it is the kind of wiring that looks right and is wrong. `@effected/xdg` resolves where a namespace's directories are. `@effected/store` opens a database at a path. Between them sits an ordering nobody thinks about until it bites: `SqliteClient.layer` has no error channel and **defects** on a missing parent directory, so the directory must be ensured *before* the store layer is built, or the failure arrives as a defect that nothing downstream can catch typed.

The other half is the namespace itself. An application names it for its directories, then names it again for its config file, and the two strings drift — `"myapp"` here, `"my-app"` there — and now it reads config from a directory nothing else in the process ever writes to.

This package is the composition that gets both right, and that is all it is. It owns **no domain logic**: no service, no schema, no error class, and it re-exports nothing. The entire surface is layer factories, one config preset and one type alias. If a change here wants a `Context.Service`, that is the signal the change belongs in one of the three packages beneath it.

**No library or package may depend on `@effected/app`** — but the application at the top of the graph is exactly its intended consumer. A library taking an application control plane as a dependency would drag a SQLite driver into its own consumers' trees. This is the package an application composes at its edge — and the only one in the kit whose docs show where OpenTelemetry goes.

## Install

```bash
npm install @effected/app effect @effected/xdg @effected/store @effected/config-file
```

```bash
pnpm add @effected/app effect @effected/xdg @effected/store @effected/config-file
```

Requires Node.js >=24.11.0.

All `@effected/*` packages are ESM-only: the exports maps publish only `import` conditions, so `require()` — including tools that resolve in CJS mode — fails with Node's `ERR_PACKAGE_PATH_NOT_EXPORTED` rather than loading a CJS build that does not exist. Import from an ES module.

There are **no runtime dependencies**. `effect` v4 is a peer dependency, and so are `@effected/xdg`, `@effected/store` and `@effected/config-file` — which is load-bearing rather than incidental. Each of the three appears in this package's public signature types, so a second copy of any of them in your graph would mint two distinct service tags for one concept and the layer would silently fail to satisfy the requirement. Single copies are the point, and that is exactly what a peer declares. Package managers that install peers automatically will pull them in; add them to your manifest explicitly if yours does not.

The package is integrated tier **by inheritance, not by anything it does**: `@effected/store` reaches `@effect/sql-sqlite-node`, and that propagates. It performs no IO the three packages beneath it do not already perform.

Creating directories needs a `FileSystem` and a `Path` implementation, provided once at the edge — from `@effect/platform-node` on Node.

## Quick start

A config file, a cache and a state database, over one platform import:

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

// Bound once, to a const — see Memoization below. This is the whole control plane:
// XDG dirs for "myapp", store.db in the state dir, cache.db in the cache dir.
const AppLive = App.layer({ namespace: "myapp", store: { migrations }, cache: { maxEntries: 500 } });

const ConfigLive = AppConfig.layer(SettingsFile, {
  filename: "config.json", // no namespace: it comes from AppLive's AppDirs
  schema: Settings,
  codec: JsonCodec,
});

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

Four services, one platform import, one namespace typed once, and every failure on the typed channel. That is the whole package.

## Where the files land

`App.layer` ensures each directory before it opens anything in it. With `namespace: "myapp"` and the default `native: false`, the XDG rules apply on every platform:

| What | Directory | Default file |
| ---- | --------- | ------------ |
| State database | `$XDG_STATE_HOME/myapp` — `~/.local/state/myapp` | `store.db` |
| Cache database | `$XDG_CACHE_HOME/myapp` — `~/.cache/myapp` | `cache.db` |
| Config file | `$XDG_CONFIG_HOME/myapp` — `~/.config/myapp` | your `filename` |

`AppOptions` is [`@effected/xdg`](../xdg)'s `AppDirsOptions` straight through — `namespace`, `native`, `fallbackDir` and `dirs` mean there exactly what they mean here, five-rung precedence ladder included, and this package re-documents none of it.

`AppStore` and `AppCache` take a `directory` (`"state"`, `"data"` or `"cache"`; defaults as above) and an optional relative `subdir` under it, created with `mkdir -p` before the database opens — so `{ directory: "data", subdir: "projects/abc123", filename: "data.db" }` lands at `~/.local/share/myapp/projects/abc123/data.db`. A `subdir` that cannot be created fails on the same typed `AppDirsError` as the directory itself; because of that `mkdir`, the database layers need `FileSystem` as well as `AppDirs` and `Path`.

Every `filename` takes a **single path component**, and every `subdir` component obeys the same rule (no empty component, no `.` or `..`, no leading `/`, no `\`). Both are wiring, so a bad one **dies** rather than failing typed. A `subdir` derived from runtime data — a per-project key from a path — must therefore come from a derivation that can only produce valid components, such as a hash:

```ts
import { createHash } from "node:crypto";

const subdir = createHash("sha256").update(projectRoot).digest("hex").slice(0, 16);
``` An empty name, one containing a separator, or `.` / `..` would escape the namespace directory, so it dies at layer construction: it can only come from code, never from user input.

## The namespace is typed once

`AppConfig.layer` takes no namespace. It reads one from the ambient `AppDirs` service at layer build time, so the namespace is named exactly once — in `App.layer` — and the two-strings drift cannot happen. Anything that can be derived is not asked for.

What it does take is a **codec, required**, never inferred from the filename's extension. Inferring one would hard-code a *format* choice into a composition layer, which is not this package's decision to make; and the named import is also what keeps the other three parsing engines out of your bundle.

`AppConfig` lives in its own module and reaches `@effected/xdg` and `@effected/config-file` **only** — never `@effected/store`. An application that wants XDG-placed config files and no database imports `AppConfig` alone, and no SQLite driver enters its graph. `App`, `AppStore` and `AppCache` are the exports that reach a database, and keeping the two graphs apart is why there is no `App = { … }` namespace object here.

## A `--config` flag, without leaving the preset

Most CLIs have one, and it has to outrank the app's own search path. Pass `resolvers` and it does:

```ts
import { AppConfig } from "@effected/app";
import { ConfigResolver, TomlCodec } from "@effected/config-file";

const ConfigLive = AppConfig.layer(SettingsFile, {
 filename: "settings.toml",
 schema: Settings,
 codec: TomlCodec,
 // Composed AHEAD of the XDG chain, in the order given.
 resolvers: flag === undefined ? [] : [ConfigResolver.explicitPath(flag)],
});
```

The XDG search path and the native probe stay behind whatever you prepend, so absent the flag nothing changes. `ConfigResolver.staticDir` covers a `--config` naming a directory, and `ConfigResolver.upwardWalk` a project-local file found by walking up from the cwd.

Two properties to be deliberate about. **A resolver that finds nothing falls through**: every `ConfigResolver`'s error channel is `never` by contract, so a `--config` pointing at a file that does not exist quietly loads the XDG config instead. If that must be an error, check the path before you build the layer — discovery cannot make that distinction for you. And **the save path is unaffected**: `save` still writes to the app's own config directory, so writing back to the file a flag named is `write(value, path)`, which takes the path explicitly.

### Wiring the flag to the layer

A layer is built before a CLI parses anything, so the parsed `--config` has to reach `AppConfig.layer` somehow. `effect/cli` has two ways, and neither needs an `Effect.provide` inside the handler.

For a single command, `Command.provide` takes **a function of the parsed input**, not just a finished layer:

```ts
Command.make("validate", { config: Flag.string("config").pipe(Flag.optional) }, () =>
 Effect.gen(function* () {
  const settings = yield* (yield* SettingsFile).load; // just requires the service
 }),
).pipe(Command.provide(({ config }) => makeConfigLive(Option.getOrUndefined(config))));
```

For several subcommands sharing one `--config`, make the flag a **global setting** — `GlobalFlag.setting` returns a `Context.Service`, so the parsed value can sit in the layer's `R` and the layer attaches once at the root:

```ts
const ConfigFlag = GlobalFlag.setting("config")({ flag: Flag.string("config").pipe(Flag.optional) });

const ConfigLive = Layer.unwrap(Effect.map(ConfigFlag, (f) => makeConfigLive(Option.getOrUndefined(f))));

const root = Command.make("myapp", {}, () => Effect.void).pipe(
 Command.withSubcommands([validate, sync]),
 Command.provide(ConfigLive), // one call site, every subcommand
 Command.withGlobalFlags([ConfigFlag]),
);
```

The flag is then accepted on either side of the subcommand name.

A chain that needs the XDG resolvers somewhere other than last — or not at all — has outgrown the preset. Compose `ConfigFile.layer` from [`@effected/config-file`](../config-file) directly and order the whole chain yourself; it costs you only the `defaultPath` and ambient-namespace wiring this preset does for free.

Its `native` option defaults to **`true`** — the opposite of `AppDirsOptions.native`, and the asymmetry is deliberate. *Creating* a native directory commits an application to a location, so it is opt-in; *probing* one for a config file the user already put there costs a `stat` that finds nothing, so it is opt-out. Reading `~/Library/Application Support` is a courtesy; writing there uninvited is not.

## Ensure before open

The one thing this package actually claims. `AppStore.layer` yields `AppDirs`, runs `ensureState`, joins the path, and only then hands it to `Store.layerSqlite`; `AppCache.layer` does the same over `ensureCache`. That ordering converts a defect surface into a typed one — `AppDirs.ensure*` is a `mkdir -p` on a **typed** `AppDirsError` channel, so "the state directory could not be created" arrives as a recoverable boundary failure rather than a die.

Nothing is `orDie`d to make a signature tidier. A regression test pins an unwritable ancestor to a typed failure and watches for a die.

`App.layer` always provides **both** databases. An application that wants only one composes `AppStore.layer` or `AppCache.layer` directly and never opens the other file. The honest consequence: passing no `cache` options **still opens `cache.db`**, because every `CacheOptions` field is optional and absence means defaults, not absence.

## Memoization: bind the layer to a const

Every export here is a **parameterized layer factory**, and Effect memoizes layers **by reference**. Each call to `App.layer(…)` builds a new one.

```ts
const AppLive = App.layer({ namespace: "myapp", store: { migrations } }); // once
```

Call the factory inline at two provide sites and you open **two databases**: two connections onto one file, two migration ledgers, and two independent `CacheEvent` PubSubs whose subscribers each see half the events. This is the package where an application is most likely to compose the same layer twice, which is why the rule is here and not in a footnote.

## Databases per command: directories everywhere

Building `App.layer` **opens and migrates both databases**, eagerly — `store.db` and `cache.db` exist the moment the layer is built, whether or not the program touches them. For a long-running service that is what you want. For a CLI it is not: provide `App.layer` at the entry point and every command creates and migrates both files, `--help`-adjacent paths included, and a command that deletes the app's files ends up deleting a database its own process holds open.

`App.layerDirs` is the directories half on its own — `Xdg` and `AppDirs` for one namespace, `XdgEnvError` on the error channel, `FileSystem` and `Path` in `R`, and no database opened. Provide it once at the edge, bind each database layer once at module scope, and attach it with `Command.provide` only on the commands that use it:

```ts
import { App, AppStore } from "@effected/app";
import { CliRuntime } from "@effected/cli";
import { Store } from "@effected/store";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { Command } from "effect/cli";

// Module scope, bound once: built once per provided layer graph.
const StoreLive = AppStore.layer({ migrations });

// Opens store.db — only when `history` runs.
const history = Command.make("history", {}, () =>
  Effect.gen(function* () {
    const store = yield* Store;
    yield* store.client`SELECT id FROM runs`;
  }),
).pipe(Command.provide(StoreLive));

// Opens no database at all.
const where = Command.make("where", {}, () => Effect.void);

const cli = Command.make("myapp").pipe(Command.withSubcommands([history, where]));

// Directories at the edge, once; AppDirs satisfies StoreLive's requirement.
const PlatformLive = App.layerDirs({ namespace: "myapp" }).pipe(Layer.provideMerge(NodeServices.layer));

NodeRuntime.runMain(CliRuntime.main(Command.run(cli, { version: "1.0.0" }), { platform: PlatformLive }));
```

A module-scope binding such as `StoreLive` stays **one** connection however many composites reuse it inside one provided layer graph — `Layer.mergeAll(StoreLive, …)` beside `Repo.pipe(Layer.provide(StoreLive))` — because a layer graph memoises by reference, and an `Effect.provide` nested inside another reuses what the enclosing one already built. Provides that are not nested — one after another, or side by side under a common parent — each build it, and so open the database, again.

`Command.provide` also accepts a function of the command's parsed input, `(input) => Layer`, for a database whose options depend on a flag. Bind anything that does not depend on the input outside that function — a layer built inside it is a new reference on every call.

## More than one store

`AppStore.layer` and `AppCache.layer` provide the kit's single `Store` and `Cache` services. An application that keeps a second database — a registry beside its run history, a separate cache for large objects — declares its own service key over the same shape and builds it with `layerAs`:

```ts
import { AppCache, AppStore } from "@effected/app";
import type { CacheShape, StoreShape } from "@effected/store";
import { Context, Layer } from "effect";

class RegistryStore extends Context.Service<RegistryStore, StoreShape>()("myapp/RegistryStore") {}
class TarballCache extends Context.Service<TarballCache, CacheShape>()("myapp/TarballCache") {}

// Every one bound once, to a const.
const StoreLive = AppStore.layer({ migrations });
const RegistryStoreLive = AppStore.layerAs(RegistryStore, { filename: "registry.db", migrations: registryMigrations });
const TarballCacheLive = AppCache.layerAs(TarballCache, { filename: "tarballs.db", maxEntries: 200 });

const DatabasesLive = Layer.mergeAll(StoreLive, RegistryStoreLive, TarballCacheLive);
```

Each keyed layer runs the same ensure-before-open glue, in the same default directory as its primary — state for stores, cache for caches, unless `directory` / `subdir` say otherwise — and outputs **only its own key**: the `Store` or `Cache` it builds internally never leaks, so it composes beside the primary without shadowing it. Each file has its own migrations and its own ledger.

- **`filename` is required.** A default of `store.db` or `cache.db` would land a keyed layer silently on the primary's file — two connections and two migration ledgers on one database.
- **The key's service type must be `StoreShape` or `CacheShape`.** An incompatible shape is a compile error, and so is one that adds members (`StoreShape & { … }`), reported as an argument not assignable to `never` because this layer cannot supply them. The check cannot see through method-syntax parameter bivariance: a member redeclared as a method with a wider parameter still compiles.
- **Bind every keyed layer to a `const`.** Each `layerAs(…)` call is a new layer, and the memoization trap above applies to each one separately: two inline calls with the same key open the file twice.

The keyed layers need `AppDirs`, `Path` and `FileSystem`, which is exactly what `App.layerDirs` plus the platform provides — they slot into the per-command shape above unchanged.

Every `AppStore` / `AppCache` option beyond the path is `@effected/store`'s, passed straight through: `client` (driver options such as `busyTimeout` and `disableWAL` — the place for per-connection settings, never a migration), `checkpointOnClose`, `onConnect` (a per-connection hook run before the ledger, outside any transaction), and on stores `adoptMigratorLedger` and `mirrorMigratorLedger`, which move a database previously migrated by effect/sql's `Migrator` onto `Store` without re-running its history and keep that ledger current for older versions (see `@effected/store`'s README for the rules). A database at an absolute or host-chosen path is not an app concern: use `Store.layerSqliteAs` / `Cache.layerSqliteAs` from `@effected/store` directly.

### Where is the file?

A program that reports or persists the database path — a `doctor` command, a "your data lives at" line — derives it with `AppStore.location(options)` / `AppCache.location(options)`, passing the same options it passes the layer. It resolves the absolute path from the ambient `AppDirs` without creating anything (`R` is `AppDirs | Path`), and it is the very derivation the layers use, so the reported path and the opened file cannot disagree:

```ts
const options = { filename: "registry.db", directory: "data", migrations } as const;

const RegistryStoreLive = AppStore.layerAs(RegistryStore, options);
const where = AppStore.location(options); // Effect<string, never, AppDirs | Path>
```

## Testing: one line, no platform package

`App.layerTest` is the hermetic control plane — fixed XDG paths, `:memory:` databases, and the platform layers provided *internally* rather than merged into the output. A consumer's first test needs no platform import at all:

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

The documented limit, stated up front so nobody finds it in a debugger: code paths that actually exercise `ensure*` **die** against the stub filesystem `layerTest` provides. It is for testing logic that *uses* the control plane. Real directory behavior is tested through `App.layer` against a temp-directory `HOME`, which is what this package's own integration suite does.

## Errors

`AppError` is a **type-only** alias — the copy-pasteable union for the `catchTags` block at the application edge. It defines nothing: every tag in it is raised, and documented, by the package beneath that owns the operation, and each flows through unwrapped. A `StoreMigrationError` that reaches your handler still carries the migration's `id`, `name` and `direction`.

| Tag | Raised by | Means |
| --- | --------- | ----- |
| `XdgEnvError` | [`@effected/xdg`](../xdg) | `$HOME` is not set — the one environment failure there is. |
| `AppDirsError` | [`@effected/xdg`](../xdg) | A directory could not be created. Check permissions. |
| `StoreError` | [`@effected/store`](../store) | The state database's own SQL failed — ledger bookkeeping, or the queries around a migration. |
| `StoreMigrationError` | [`@effected/store`](../store) | One of your migrations failed. Carries `direction`, `id` and `name`. |
| `CacheError` | [`@effected/store`](../store) | A cache operation's SQL failed. A cache is a cache — falling back to the origin is usually right. |

Wiring mistakes are **defects**, not errors: a `filename` that is not a single path component dies at layer construction, as does a `namespace` that would escape `$HOME`. They can only come from code.

## Telemetry goes at the app edge

This package emits **no spans of its own**, deliberately. Every fallible operation in the glue is already spanned by the package that owns it — `AppDirs.ensure*` by xdg, migrations and every `Cache` method by store, every `ConfigFile` method by config-file. A span here would be a span around another package's span.

Every library in this kit is telemetry-agnostic and none of them import `@effect/opentelemetry`. **Applications do, exactly once, at the top:**

```ts
import { NodeSdk } from "@effect/opentelemetry";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";

const TelemetryLive = NodeSdk.layer(() => ({
  resource: { serviceName: "myapp" },
  spanProcessor: new BatchSpanProcessor(new OTLPTraceExporter()),
}));

const MainLive = ConfigLive.pipe(
  Layer.provideMerge(AppLive),
  Layer.provide(NodeServices.layer),
  Layer.provide(TelemetryLive), // composed once, beneath everything
);
```

Provide it beneath the stack and every span the kit's packages already emit — directory creation, migrations, cache reads, config loads — arrives at your collector. Nothing in the libraries changes, because a library that chose an exporter for you would be making an application's decision.

## Features

- `App.layer` — the control plane: `Xdg`, `AppDirs`, `Store` and `Cache` from one call, with only `FileSystem` and `Path` left for the platform layer to supply.
- `App.layerDirs` — `Xdg` and `AppDirs` alone, opening no database: directories everywhere, databases attached only where they are used.
- `App.layerTest` — the same four services, hermetic: synthetic XDG paths, `:memory:` databases, no platform package required.
- `AppStore.layer` / `AppCache.layer` — the state-directory and cache-directory databases on their own, each ensuring its directory before it opens the file.
- `AppStore.layerAs` / `AppCache.layerAs` — an additional database under a service key you define, with its own file, migrations and ledger.
- `AppConfig.layer` — `@effected/config-file` wired to xdg's resolver chain and save path, with the namespace read from the ambient `AppDirs` and the codec named by you.
- `AppError` — the type-only union of everything the control plane can fail with, for the `catchTags` block at the edge.

## License

[MIT](LICENSE)
