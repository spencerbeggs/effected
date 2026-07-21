# @effected/app

## 0.2.1

### Bug Fixes

* ### Internal @effected edges float patches instead of pinning exact versions

  The kit's internal `@effected/*` dependency edges were declared as `workspace:*`, which the publish transform projects to an exact version pin. That coupled every kit release — a single sibling patch forced a coordinated re-release of every dependent, just to move the pin — and two paths pinning adjacent exact versions could not dedupe in a consumer's tree.

  Every internal `@effected/*` edge, both peer and regular dependency, is now declared `workspace:~`, which projects to a patch-floating `~0.x.y` range. A sibling patch flows into existing releases without a re-release, while a minor bump — the kit's breaking channel on the `0.x` line — still requires the intended coordinated release because `~` holds the minor. Floating the regular-dependency edges as well lets a consumer's paths dedupe onto one sibling copy, which matters where an integrated package surfaces a sibling's types across its API. The `effect` peer, the catalog specifiers, and the `devDependencies` mirrors are unchanged. [#134][#134]

### Dependencies

| Dependency            | Type       | Action  | From  | To    |
| --------------------- | ---------- | ------- | ----- | ----- |
| @effected/config-file | dependency | updated | 0.1.6 | 0.1.7 |
| @effected/xdg         | dependency | updated | 0.1.6 | 0.1.7 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#134]: https://github.com/spencerbeggs/effected/pull/134

## 0.2.0

### Features

* ### effected plugin: sharper planning and testing skill guidance

  The bundled Effect v4 skills gain guidance drained from the round-4 dogfood
  sweep, so the plugin versions with this release.

  The planning gate now runs a placement check before design begins: it confirms
  the target package's tier admits the capability, treating IO or a service in a
  pure-tier package as a stop, and checks the dependency direction against the
  peer graph so a capability that would close a cycle is caught up front. Its
  contract inventory now greps the sibling packages rather than core alone,
  because in this monorepo the likelier duplication is a sibling that already owns
  the concept. Its delegated-subagent rule separates a decision that contradicts
  the parent's instructions, which stops and asks, from one that exceeds them
  without contradicting, which proceeds and flags the consequence in the report.

  The testing skill's zero-collected-tests section gains the wrong-directory
  producer: a root-relative project filter run from inside a package prints a
  clean-looking zero and exits zero, so project-filtered runs belong at the repo
  root. [#130][#130]

- ### effected plugin: Result-parity is taught as the ratified kit rule

  The observability and testing skills described the sync-primitive convention as an emerging pattern observed in `@effected/jsonc`. It has since been ratified kit-wide, and the skills now teach it as policy with a scope test rather than an observation.

  The observability skill states the rule outright: a public boundary returning `Effect` with nothing in `R`, no async step and no IO must expose the sync form as the primitive, spelled `*Result` — never `*Sync`, which the kit reserves for genuinely-blocking-IO facades — with the `Effect` variant defined in terms of it behind its named span. Interface and adapter seams are called out as out of scope, and an in-scope boundary with no `*Result` twin is now named as a review finding alongside the existing span-discipline findings.

  The testing skill's narrowing guidance no longer cites `Jsonc.parseResult` as the lone example: the `Result.isSuccess`/`Result.isFailure` trap now lists the full settled surface — `parseResult`/`stringifyResult` across the format packages, `parseTreeResult`, glob's `compileResult` and semver's `parseResult`/`intersectResult`. [#132][#132]

### Dependencies

| Dependency            | Type       | Action  | From  | To    |
| --------------------- | ---------- | ------- | ----- | ----- |
| @effected/config-file | dependency | updated | 0.1.5 | 0.1.6 |
| @effected/xdg         | dependency | updated | 0.1.5 | 0.1.6 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#130]: https://github.com/spencerbeggs/effected/pull/130

[#132]: https://github.com/spencerbeggs/effected/pull/132

## 0.1.6

### Dependencies

| Dependency            | Type       | Action  | From  | To    |
| --------------------- | ---------- | ------- | ----- | ----- |
| @effected/config-file | dependency | updated | 0.1.4 | 0.1.5 |
| @effected/xdg         | dependency | updated | 0.1.4 | 0.1.5 |

## 0.1.5

### Dependencies

| Dependency            | Type       | Action  | From  | To    |
| --------------------- | ---------- | ------- | ----- | ----- |
| @effected/config-file | dependency | updated | 0.1.3 | 0.1.4 |
| @effected/store       | dependency | updated | 0.1.0 | 0.1.1 |
| @effected/xdg         | dependency | updated | 0.1.3 | 0.1.4 |

* | Dependency | Type           | Action  | From          | To            |                                                                       |
  | ---------- | -------------- | ------- | ------------- | ------------- | --------------------------------------------------------------------- |
  | effect     | peerDependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 | [#122][#122] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#122]: https://github.com/spencerbeggs/effected/pull/122

## 0.1.4

### Documentation

* Corrected the `effect-v4-construct-map` skill's Schema rename reference: the
  `decode`/`encode` family is not a blanket sweep. Only the Effect-returning
  base names (`decode`/`decodeUnknown`/`encode`/`encodeUnknown` → `*Effect`)
  and the `*Either` variants (→ `*Result`/`*Exit`) are renamed; the
  `*Sync`/`*Option`/`*Promise` variants survive unchanged, and the typed and
  `Unknown` flavors of each differ by input type rather than being
  interchangeable. Also notes that `Schema.decode`/`Schema.encode` still exist
  in v4, but as transformation combinators rather than parsers. [#112][#112]

### Dependencies

| Dependency            | Type       | Action  | From  | To    |
| --------------------- | ---------- | ------- | ----- | ----- |
| @effected/config-file | dependency | updated | 0.1.2 | 0.1.3 |
| @effected/xdg         | dependency | updated | 0.1.2 | 0.1.3 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#112]: https://github.com/spencerbeggs/effected/pull/112

## 0.1.3

### Documentation

* Corrects effected-plugin skill guidance surfaced by dogfooding (the plugin ships bundled with `@effected/app`).

  * `@effected/workspaces` sync escape hatch documented as free-standing consts in the main entrypoint taking a consumer-supplied sync filesystem/path — not a `WorkspacesSync` namespace, and not Node-only
  * Construct map gains the namespace-qualified `ChildProcessSpawner.ChildProcessSpawner` access pattern, the `NodeHttpClient.layer` removal, and the `ConfigProvider.fromMap` → `fromUnknown` / `withConfigProvider` reshapes; the platform reference is re-verified against beta.98
  * Migration guidance now tells plain-Vitest repos to adopt `@effect/vitest` from `catalog:effect` rather than treating plain Vitest as nothing to migrate
  * Clarifies that the `@effected/app` no-dependency rule bars other libraries, not the application itself, which is its intended consumer
  * Adds a predecessor (`*-effect`) → `@effected` migration bridge for `xdg-effect`, `config-file-effect` and `workspaces-effect` [#106][#106]

### Dependencies

| Dependency            | Type       | Action  | From  | To    |
| --------------------- | ---------- | ------- | ----- | ----- |
| @effected/config-file | dependency | updated | 0.1.1 | 0.1.2 |
| @effected/xdg         | dependency | updated | 0.1.1 | 0.1.2 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#106]: https://github.com/spencerbeggs/effected/pull/106

## 0.1.2

### Documentation

* The bundled effected plugin's Effect v4 skills absorb three findings from the systems dogfood rounds: `effect-v4-idioms` and the construct map now document `Effect.catchTag`'s non-empty tag-array form (`Effect.catchTag(["A", "B"], recover)`, verified at beta.98), and `effect-v4-schema`'s make-vs-new rule now explicitly blesses the yieldable `yield* new SomeError({...})` construction for `TaggedErrorClass`, matching the house code across glob, workspaces and walker. [#91][#91]

- The bundled effected plugin's package-index skill (`effected-packages`) is enriched across all 18 per-package references: each now enumerates the package's feature surface — services, schema classes, statics, options bags and error types — with generic usage examples distilled from real consumer integration, verified against the built declarations. Six stale claims were corrected along the way, including the single-entrypoint claim (workspaces now ships `./node-sync`), `Package.setVersion`'s string parameter, `GitHubAuth`'s real statics, and the previously undocumented `TsconfigLoaderSync` and `Manifest` surfaces. [#91][#91]

### Dependencies

| Dependency            | Type       | Action  | From  | To    |
| --------------------- | ---------- | ------- | ----- | ----- |
| @effected/config-file | dependency | updated | 0.1.0 | 0.1.1 |
| @effected/xdg         | dependency | updated | 0.1.0 | 0.1.1 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#91]: https://github.com/spencerbeggs/effected/pull/91

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
