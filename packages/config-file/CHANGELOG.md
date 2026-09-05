# @effected/config-file

## 0.6.0

### Breaking Changes

#### `@effected/schemastore` no longer ships `AnnotationCarriers`

- `AnnotationCarriers` and `CarrierDepthExceededError` are removed, and the module is deleted.

- Effect `4.0.0-rc.112` ("Make JSON Schema dialect conversions preserve custom keywords") changed the Draft-07 lowering to carry unknown and custom keywords through as opaque values, in place — including across the tuple coordinate moves (`prefixItems[i]` to `items[i]`, and a trailing `items` to `additionalItems`). The post-lowering re-graft those symbols performed is therefore redundant, and **emitted documents are unchanged**.

- If you imported either symbol, delete the call: annotate a schema node and the key now reaches the document on its own.

#### `StoreDocument` and `SchemaPipeline` error channels are wider

- `StoreDocument.fromSchema`, `StoreDocument.fromSchemaResult`, and `SchemaPipeline.run` / `check` / `runOne` / `checkOne` can now fail with `UndeclaredAnnotationKeyError`. Callers matching exhaustively on the error channel need one new branch.

### Features

#### `@effected/schemastore` refuses undeclared annotation keys instead of dropping them

- `StoreDocument.fromSchema` now fails with the new `@public` `UndeclaredAnnotationKeyError` — carrying the document's `$id` and every offending key — when a caller-supplied `includeAnnotationKey` admits a key outside the declared keyword families (the vscode set, `x-taplo`, `x-tombi-*`, `x-intellij-*`, `x-ai-*`).

- Previously such keys were admitted into the Draft 2020-12 document and silently discarded by the Draft-07 lowering, so the package's compatibility guarantee was really a side effect of a dependency's behavior. Since rc.112 no longer discards them, that guarantee is now enforced by the package itself — and enforced loudly, because a caller who asks for a key and silently does not get it has no way to notice.

- Declared families are still admitted unconditionally, regardless of the caller's predicate.

```ts
// Fails: UndeclaredAnnotationKeyError, keys: ["x-custom"]
yield* StoreDocument.fromSchema(schema, {
  $id: "https://example.com/schemas/tool.json",
  jsonSchema: { includeAnnotationKey: (key) => key === "x-custom" },
});
```

#### The whole kit tracks Effect `4.0.0-rc.112`

- Every package's `effect` peer moves to the new pin. The kit uses exact prerelease pins rather than a caret, so a consumer must move with it.

### Bug Fixes

- `@effected/schemastore`: the `#/definitions` to `#/$defs` `$ref` rewrite no longer descends into declared-family annotation values. A `$ref`-shaped string inside an `x-taplo` or `x-ai-*` payload is opaque advice addressed to a language server, and was being rewritten in transit.
- A known limitation, still open upstream as [Effect-TS/effect#8084](https://github.com/Effect-TS/effect/issues/8084): a `Schema.Class`'s class-level annotations — `title` and `description` as well as the declared families — never reach the emitted document, because core generates the definition from the class's encoded AST. A hoisted `Schema.Struct` keeps its annotations. Annotate a `Schema.Struct` root instead.

### Documentation

#### The Claude Code and Copilot plugins are Effect v4 only

- The v3-to-v4 migration material is retired: the `effect-migrator` agent and the `effect-v4-construct-map` skill are removed, along with the migration framing that ran through the remaining skills. The facts underneath it are kept, restated as statements of what v4 is rather than what changed.

- The SessionStart briefing now states plainly that an agent's recall of Effect is out of date by construction, and routes it to the specialist agents or the skills rather than to a guess. It also reports whether the repo vendors Effect source at `.repos/effect` and whether that pin matches the kit's — a stale vendored tree is worse than none, because it answers confidently and wrongly.

- Several skill claims were re-measured against rc.112 and corrected, including one whose stated mitigation pointed at the wrong signal: for a zero-collection vitest run it is the `Tests: 0/0 passed` line that lies, while the exit code is honest. [#623][#623]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/jsonc | dependency | updated | 0.8.1 | 0.9.0 |
| @effected/toml | dependency | updated | 0.5.0 | 0.6.0 |
| @effected/walker | dependency | updated | 0.5.0 | 0.6.0 |
| @effected/yaml | dependency | updated | 0.12.0 | 0.13.0 |
| @effect/tsgo | devDependency | updated | 0.36.5 | 0.41.0 |
| @effect/vitest | devDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |
| effect | devDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |
| effect | peerDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#623]: https://github.com/spencerbeggs/effected/pull/623

## 0.5.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/jsonc | dependency | updated | 0.7.0 | 0.8.0 |
| @effected/yaml | dependency | updated | 0.11.0 | 0.12.0 |

## 0.5.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/yaml | dependency | updated | 0.10.0 | 0.11.0 |

## 0.5.0

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/jsonc | dependency | updated | 0.6.0 | 0.7.0 |
| @effected/toml | dependency | updated | 0.4.0 | 0.5.0 |
| @effected/walker | dependency | updated | 0.4.0 | 0.5.0 |
| @effected/yaml | dependency | updated | 0.9.0 | 0.10.0 |

- | Dependency | Type | Action | From | To |  |
  | :-- | :-- | :-- | :-- | :-- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.107 | 4.0.0-rc.109 | [#389][#389] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#389]: https://github.com/spencerbeggs/effected/pull/389

## 0.4.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/yaml | dependency | updated | 0.8.0 | 0.9.0 |

## 0.4.1

### Documentation

- Corrects what a `Schema.StructWithRest` rest does to excess checking. The previous wording — "keys covered by a rest are not excess" — described the outcome but implied the wrong mechanism, and the shape suggests the reverse of the truth.

  Measured against `effect@4.0.0-beta.107`: a rest **switches the excess-property check off for that struct entirely**, not merely for the keys the rest covers. A struct owning an index signature skips the pass, so `{ a, b }` is accepted *and* `b` is preserved even under `onExcessProperty: "error"`. Structs without a rest stay strict independently, which makes strictness a per-level decision rather than a per-key one.

  The practical consequence is unchanged for a schema with a deliberate pass-through section — it still works under `"error"` — but a reader who added a rest to a *top-level* schema expecting to keep strictness elsewhere in it would have lost the check without a signal. [#354][#354]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#354]: https://github.com/spencerbeggs/effected/pull/354

## 0.4.0

### Features

- ### `parseOptions` on config loading, for strict config files
  `ConfigFileOptions`, `ConfigReadOptions` and `AppConfigOptions` each take an optional `parseOptions`, threaded into every schema decode. The field that matters is `onExcessProperty`:
  ```ts
  const ConfigLive = AppConfig.layer(SettingsFile, {
  	filename: "settings.toml",
  	schema: Settings,
  	codec: TomlCodec,
  	parseOptions: { onExcessProperty: "error" },
  });
  ```
  It defaults to core's `"ignore"`, so **nothing changes for existing consumers** — unknown keys are still dropped silently unless you ask otherwise.

  Why it is worth asking for: a loader that silently discards part of a user's file cannot report a typo'd section name, and cannot enforce a field the schema deliberately removed. A user migrating from an older format keeps a removed credential field, is told nothing, and believes a dead token is live. With `"error"` that becomes a `ConfigValidationError` whose issue names the offending path.

  `validate` cannot substitute for it: `validate` runs on the *decoded* value, by which point the excess keys are already gone and there is nothing left to detect.

  Keys covered by a `Schema.StructWithRest` rest are **not** excess, so a schema that deliberately admits a pass-through section — `[settings.*]` and the like — keeps working under `"error"`. [#352][#352]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#352]: https://github.com/spencerbeggs/effected/pull/352

## 0.3.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/yaml | dependency | updated | 0.7.0 | 0.8.0 |

## 0.3.0

### Refactoring

- Migrated error classes to Effect's renamed `Schema.TaggedError` (was `Schema.TaggedErrorClass`); the call shape is unchanged and no consumer action is required. [#322][#322]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/jsonc | dependency | updated | 0.5.2 | 0.6.0 |
| @effected/toml | dependency | updated | 0.3.2 | 0.4.0 |
| @effected/walker | dependency | updated | 0.3.4 | 0.4.0 |
| @effected/yaml | dependency | updated | 0.6.1 | 0.7.0 |
| effect | peerDependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#322]: https://github.com/spencerbeggs/effected/pull/322

## 0.2.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/jsonc | dependency | updated | 0.5.1 | 0.5.2 |
| @effected/toml | dependency | updated | 0.3.1 | 0.3.2 |
| @effected/walker | dependency | updated | 0.3.3 | 0.3.4 |
| @effected/yaml | dependency | updated | 0.6.0 | 0.6.1 |

### Maintenance

- Switching internal dependency versioning from `~` to `^` ranges.

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.2.0

### Features

- Added `ConfigFile.read`, a one-shot read-and-decode over a schema and an
  explicit `ConfigCodec` — for the common case of reading one config file
  without standing up a per-schema service class and its layers.
  ```ts
  import { ConfigFile } from "@effected/config-file";
  import { JsonCodec } from "@effected/config-file";

  const config = ConfigFile.read("./app.json", { schema: AppShape, codec: JsonCodec });
  ```
  The codec is always an explicit argument, never inferred from a file
  extension — this keeps the free-standing-codec tree-shaking guarantee: a
  consumer that only ever passes `JsonCodec` never pulls in the YAML or TOML
  parsing engines. [#180][#180]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/walker | dependency | updated | 0.3.2 | 0.3.3 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#180]: https://github.com/spencerbeggs/effected/pull/180

## 0.1.9

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/yaml | dependency | updated | 0.5.1 | 0.6.0 |

## 0.1.8

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/jsonc | dependency | updated | 0.5.0 | 0.5.1 |
| @effected/toml | dependency | updated | 0.3.0 | 0.3.1 |
| @effected/walker | dependency | updated | 0.3.1 | 0.3.2 |
| @effected/yaml | dependency | updated | 0.5.0 | 0.5.1 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.99 | 4.0.0-beta.101 | [#162][#162] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#162]: https://github.com/spencerbeggs/effected/pull/162

## 0.1.7

### Bug Fixes

- ### Internal @effected edges float patches instead of pinning exact versions
  The kit's internal `@effected/*` dependency edges were declared as `workspace:*`, which the publish transform projects to an exact version pin. That coupled every kit release — a single sibling patch forced a coordinated re-release of every dependent, just to move the pin — and two paths pinning adjacent exact versions could not dedupe in a consumer's tree.

  Every internal `@effected/*` edge, both peer and regular dependency, is now declared `workspace:~`, which projects to a patch-floating `~0.x.y` range. A sibling patch flows into existing releases without a re-release, while a minor bump — the kit's breaking channel on the `0.x` line — still requires the intended coordinated release because `~` holds the minor. Floating the regular-dependency edges as well lets a consumer's paths dedupe onto one sibling copy, which matters where an integrated package surfaces a sibling's types across its API. The `effect` peer, the catalog specifiers, and the `devDependencies` mirrors are unchanged. [#134][#134]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/walker | dependency | updated | 0.3.0 | 0.3.1 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#134]: https://github.com/spencerbeggs/effected/pull/134

## 0.1.6

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/jsonc | dependency | updated | 0.4.0 | 0.5.0 |

## 0.1.5

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/toml | dependency | updated | 0.2.0 | 0.3.0 |
| @effected/walker | dependency | updated | 0.2.2 | 0.3.0 |
| @effected/yaml | dependency | updated | 0.4.0 | 0.5.0 |

## 0.1.4

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/jsonc | dependency | updated | 0.3.0 | 0.4.0 |
| @effected/toml | dependency | updated | 0.1.0 | 0.2.0 |
| @effected/walker | dependency | updated | 0.2.1 | 0.2.2 |
| @effected/yaml | dependency | updated | 0.3.1 | 0.4.0 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 | [#122][#122] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#122]: https://github.com/spencerbeggs/effected/pull/122

## 0.1.3

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/jsonc | dependency | updated | 0.2.0 | 0.3.0 |
| @effected/yaml | dependency | updated | 0.3.0 | 0.3.1 |

## 0.1.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/walker | dependency | updated | 0.2.0 | 0.2.1 |
| @effected/yaml | dependency | updated | 0.2.0 | 0.3.0 |

## 0.1.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/jsonc | dependency | updated | 0.1.0 | 0.2.0 |
| @effected/walker | dependency | updated | 0.1.0 | 0.2.0 |
| @effected/yaml | dependency | updated | 0.1.0 | 0.2.0 |

## 0.1.0

### Features

- Composable config file loading for Effect. Declare a resolver chain — an explicit path, an upward walk from the cwd, the workspace or git root, `/etc` — decode every discovered file through an Effect `Schema`, and combine the results with a merge strategy. JSON, JSONC, YAML and TOML all decode out of the box from a single install. Discovery, reading, parsing, validation and persistence each fail with their own tagged error carrying its cause structurally, so "no config anywhere" is routable separately from "the config I found is broken". Zero external runtime dependencies.
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

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/jsonc | dependency | updated | 0.0.0 | 0.1.0 |
| @effected/toml | dependency | updated | 0.0.0 | 0.1.0 |
| @effected/walker | dependency | updated | 0.0.0 | 0.1.0 |
| @effected/yaml | dependency | updated | 0.0.0 | 0.1.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#81]: https://github.com/spencerbeggs/effected/pull/81
