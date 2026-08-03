# @effected/app

## 0.5.1

### Dependencies

| Dependency            | Type       | Action  | From  | To     |
| --------------------- | ---------- | ------- | ----- | ------ |
| @effected/config-file | dependency | updated | 0.2.0 | 0.2.1  |
| @effected/store       | dependency | updated | 0.1.2 | 0.1.3  |
| @effected/xdg         | dependency | updated | 0.1.9 | 0.1.10 |

### Maintenance

* Switching internal dependency versioning from `~` to `^` ranges.

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.5.0

### Features

* ### `designing-an-action` skill

  The "effected" Claude Code plugin gains a new process skill sequencing the whole build of a new, rebuilt or ported GitHub Action: recon, a frozen parity contract with a known-unknowns ledger, one persisted API dossier, a contracts-first walking skeleton whose stubs succeed, then TDD fill per step. Where the existing `building-a-github-action` skill routes to the capability skill for a given task, this one sequences the build end to end. Session-start orientation now references four specialist subagents (up from three) and points to the new skill. [#215][#215]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#215]: https://github.com/spencerbeggs/effected/pull/215

## 0.4.1

### Documentation

* Reconciles the plugin's action-building skills with the current
  `@effected/github-actions` behavior:

  * `building-a-github-action`'s bare-`Config.*` warning now reflects that
    `ActionRuntime.layer` installs `ActionInput.layerDefault`, so a bare read
    under `Action.run` does resolve the runner's `INPUT_` derivation in
    production — the false green is specifically in test suites that bypass the
    runtime with their own `ConfigProvider`. Adds a "call sequences" reference
    table for multi-service flows (signing and storing an attestation,
    publishing an integrity-checked package, holding a token across the three
    action phases, emitting and attesting an SBOM).
  * `testing-actions` documents a `NodeServices.layer` / `ChildProcessSpawner`
    merge-order gotcha found while dogfooding: `NodeServices.layer` also
    provides `ChildProcessSpawner`, and in a `Layer.merge`/`Layer.mergeAll` the
    last provider of a duplicate service wins — so
    `Layer.mergeAll(scriptedSpawner, NodeServices.layer)` silently replaces a
    test's scripted spawner with the real one. It now also documents two
    round-2 findings: an unstubbed test double must die **lazily**
    (`() => Effect.sync(() => { throw ... })`, never a bare `throw`) so a
    consumer's `Effect.exit`/`Effect.flip` assertion sees the failure instead of
    a raw thrown error; and `ActionEnvironment.layerTest()` seeds
    `GITHUB_SERVER_URL` with the same value production defaults to, so testing
    an absence path needs `ActionEnvironment.layerFrom({})` instead.
  * `effect-api-extractor-bases` documents a fifth `{@link}` link-resolution
    failure: a re-exported cross-package `Schema.Class` referenced from a file
    that only `import type`s it fails with a distinct resolver message
    ("not supported yet by the resolver") and can attribute the diagnostic to
    the wrong line — backticks are the only fix.
  * `supply-chain-attestation` stops teaching the hand-rolled Sigstore identity
    adapter its worked example predated, pointing instead at the shipped
    `ActionsIdentityToken.layer`, and routes Actions consumers building SLSA
    provenance to `ActionsProvenance.capture` instead of hand-mapping OIDC
    claims. [#191][#191]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#191]: https://github.com/spencerbeggs/effected/pull/191

## 0.4.0

### Features

* ### GitHub Actions and API skill suite for the "effected" Claude Code plugin

  The plugin ships a twelve-skill suite for building GitHub Actions, calling the
  GitHub API, running commands, publishing releases and attesting supply-chain
  artifacts — routed from a new `building-a-github-action` entry point that
  directs to the right package and skill for a capability (and says plainly what
  does *not* exist, so an agent doesn't reach for `@actions/*` or reinvent a
  retired API). The eleven skills it routes to cover the action runtime
  (`actions-runtime`), inputs/outputs (`actions-inputs-outputs`), logging and
  reporting (`actions-reporting`), state/secrets (`actions-state-and-secrets`),
  cache and artifacts (`actions-cache-and-artifacts`), the GitHub REST/GraphQL
  surface (`github-api`), App token minting (`github-app-tokens`), running
  commands and discovering tools (`running-commands-and-tools`), release and
  publish mechanics (`release-and-publish`), SBOM/attestation
  (`supply-chain-attestation`), and the test-double conventions for this domain
  (`testing-actions`).

  A new `action-engineer` specialist subagent carries this suite end to end for
  whole action- and release-engineering tasks, joining the existing
  `effect-developer` / `effect-reviewer` / `effect-migrator` specialists.

  The existing Effect v4 skills (house style, module index, construct map,
  schema, services/layers, testing, source lookup, the `effected-packages`
  index, and `building-a-format-package`) were updated with findings from the
  program's migration and probe passes, and the session-start orientation hook
  now reflects the expanded skill and agent roster.

### Refactoring

* `App`, `AppCache`, `AppConfig` and `AppStore` are now static classes with a
  private constructor rather than `as const` namespace objects. Call syntax is
  unchanged (`App.layer(...)`); each member's TSDoc now ships in the built
  `.d.ts`, where an `as const` object's inferred member types previously
  dropped it. [#180][#180]

### Dependencies

| Dependency            | Type       | Action  | From  | To    |
| --------------------- | ---------- | ------- | ----- | ----- |
| @effected/config-file | dependency | updated | 0.1.9 | 0.2.0 |
| @effected/xdg         | dependency | updated | 0.1.8 | 0.1.9 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#180]: https://github.com/spencerbeggs/effected/pull/180

## 0.3.1

### Documentation

* The plugin's session-start guidance qualifies its delegation preference on subagent dispatch being available and permitted, and directs the constrained case to load the matching skills inline
* The API Extractor skill records that links to schema-declared class fields never resolve, whatever selector is used, and must be written as prose instead
* The schema skill's recursive-construction cost warning is re-measured against the current beta and scoped to nesting depth, so a breadth or call-count measurement is no longer mistaken for a contradiction [#175][#175]

### Dependencies

| Dependency            | Type       | Action  | From  | To    |
| --------------------- | ---------- | ------- | ----- | ----- |
| @effected/config-file | dependency | updated | 0.1.8 | 0.1.9 |
| @effected/xdg         | dependency | updated | 0.1.8 | 0.1.8 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#175]: https://github.com/spencerbeggs/effected/pull/175

## 0.3.0

### Bug Fixes

* **Retracted a false performance claim.** The schema skill warned that node-by-node construction of a recursive `Schema.Class` re-validates its whole subtree, "doubling per level" (2.7 s at depth 20, hanging past 25), and prescribed an `Object.assign(Object.create(Proto), props)` bypass. It does not reproduce: depth 20 measures \~0.1–0.2 ms and stays flat to depth 60. The guidance to add a validation bypass for cost reasons is withdrawn.
* **`Result` is not yieldable** — the idioms skill's note now covers the success case too (`yield* Result.succeed(42)` dies identically), making clear this is "`Result` is not an Effect", not "errors need a bridge". `Effect.fromResult` remains the only bridge; `Result` has no `.asEffect()`.
* Vendored-source references follow the `.repos/effect` rename, and the 16 Schema reference guides now cite the live `Effect-TS/effect` repo instead of the archived `effect-smol`.

### Documentation

* ### Schema: four gaps closed in `effect-v4-schema`

  * **`Schema.optional` is not exact-optional.** It is literally `optionalKey(UndefinedOr(self))`, so it yields `field?: T | undefined` and admits `{ field: undefined }` — which silently violates the intended contract in an `exactOptionalPropertyTypes` codebase. `Schema.optionalKey` is the exact-optional form. Includes the mechanism and the compile-level evidence.
  * **The reserved `make` collision now has a worked resolution.** A validating `static make(input: string)` is impossible on any class factory (`TS2417`, no overload escape); the kit-wide answer is the `parse` / `parseResult` pair, shown as real code.
  * **`transformOrFail`'s callback contract is documented.** Both callbacks must return an `Effect` failing with a `SchemaIssue` — not a `Result`, not a bare value — with the house `InvalidValue(Option.some(value), { message })` failure shape.
  * **Nested `Schema.Class` fields are split by self-recursion.** A *self-recursive* field (any AST node type) accepts only real instances and checks them by instance alone; a *foreign* class field accepts a literal, deep-validates it, and hands back a re-constructed value. The two behave nothing alike, and the difference decides whether identity survives construction.

  ### `@effect/vitest` must be installed by exact version

  `effect-v4-testing` previously implied a bare `pnpm add -D @effect/vitest` would resolve the right line. It does not outside a `catalog:effect` workspace: the `latest` dist-tag is the **v3** line (`0.30.0`, peering `effect@^3.22.0`), and `@beta` runs ahead of a pinned catalog. The bare form installs cleanly with no peer warning and fails only at runtime, with an error that never mentions versions. Now leads with the exact-version pin and a resolution table.

  ### House style gains the `Schema.Class` member-placement rule

  Constructors, parsers, decoders and stateless taxonomy are `static`; operations on a decoded instance are instance methods — with the in-kit precedents named.

### Dependencies

| Dependency            | Type       | Action  | From  | To    |
| --------------------- | ---------- | ------- | ----- | ----- |
| @effected/config-file | dependency | updated | 0.1.7 | 0.1.8 |
| @effected/store       | dependency | updated | 0.1.1 | 0.1.2 |
| @effected/xdg         | dependency | updated | 0.1.7 | 0.1.8 |

* | Dependency | Type           | Action  | From          | To             |                                                                       |
  | ---------- | -------------- | ------- | ------------- | -------------- | --------------------------------------------------------------------- |
  | effect     | peerDependency | updated | 4.0.0-beta.99 | 4.0.0-beta.101 | [#162][#162] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Maintenance

* Skill guidance re-verified against `effect@4.0.0-beta.101`. [#162][#162]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#162]: https://github.com/spencerbeggs/effected/pull/162

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
