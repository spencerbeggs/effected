---
status: current
module: effected
category: architecture
created: 2026-07-08
updated: 2026-07-15
last-synced: 2026-07-15
completeness: 92
related:
  - ../architecture.md
  - ../effect-standards.md
  - ../package-inventory.md
  - ../releases.md
  - jsonc.md
  - yaml.md
  - toml.md
  - package-json.md
  - walker.md
  - xdg.md
  - app.md
---

# @effected/config-file design

## Overview

`@effected/config-file` is composable config-file loading — a **boundary-tier** package built around a **codec × resolver × strategy** pipeline. A codec turns bytes into a decoded document (and back); a resolver locates candidate source files; a strategy selects or merges the located sources. All three are small seams a consumer composes explicitly. Decorator codecs (`EncryptedCodec`, `ConfigMigration`) each wrap a `ConfigCodec` and return one, so encryption, migrations and format compose freely.

The package carries all four codecs — `JsonCodec`, `JsoncCodec`, `YamlCodec`, `TomlCodec` — over the independent `@effected/jsonc`, `@effected/yaml` and `@effected/toml` format packages. The dependency arrow points one way: **config-file → format packages, never the reverse.** The format packages stay pure and unaware of config-file.

## The load-bearing constraint: free-standing named exports, never a namespace object

The codecs are **distinct named exports** — `JsonCodec`, `JsoncCodec`, `YamlCodec`, `TomlCodec`, each its own binding in its own module (`src/JsonCodec.ts` and so on), each importable in isolation. They are **not** collected into a namespace object, and `ConfigCodec` is exported as an interface only (`export type { ConfigCodec }`).

This is the whole reason the four codecs can live in one package. A namespace object collecting them (`export const ConfigCodec = { json, jsonc, yaml, toml }`) would be a **dispatch table**: referencing it at all reaches every codec, every codec reaches its engine, and a consumer importing the type or the JSON codec drags the jsonc, yaml and toml engines into its bundle. Tree-shaking would die **silently** — no error, just a bundle several hundred kilobytes larger than it should be. A namespace object is the repo's [no-barrel-re-exports](../effect-standards.md#no-barrel-re-exports) rule biting in a different syntax, and unlike a re-export barrel it survives tree-shaking analysis as a single live binding. With no object to grow, the rule is **structurally impossible to violate** rather than a convention a contributor could helpfully tidy away.

The tree-shaking property is **measured, not assumed**: bundling a consumer that names only `JsonCodec` produces a tiny bundle carrying only `ConfigCodecError` and the JSON codec (no jsonc/yaml/toml engine fingerprint anywhere), a `TomlCodec`-only consumer carries the TOML engine alone, and all four together carry all four engines. The method (bundle a single-codec consumer with the `@effected/*` edges bundled in, verify absent engines) is cheap to re-run against a doubt. **The tripwire stands:** if tree-shaking is ever falsified — realistically, only by someone collecting the codecs back into a namespace object — this whole consolidation must be revisited.

## Tier and dependencies

**Boundary tier.** All IO goes through core `FileSystem`/`Path`; the package never touches `node:fs`. R2 (the only propagation rule) names tier 3 alone, and every dependency here is a pure-tier `@effected/*` package, so the tier stays boundary.

- `peerDependencies`: `effect` (`catalog:effect`) plus four `workspace:*` edges — `@effected/jsonc`, `@effected/yaml`, `@effected/toml` (the codecs' engines) and `@effected/walker` (the upward-traversal primitives). Each is mirrored in `devDependencies`.
- `dependencies`: **none external.** The format engines arrive through the `@effected/*` peers; `smol-toml` never enters the tree (`@effected/toml` is a from-scratch engine). The accurate property is **zero external runtime dependencies** — every runtime edge is a pure `@effected/*` package, which is what [R1](../effect-standards.md#dependency-policy) permits.
- `devDependencies`: the four peers mirrored, plus `@effect/platform-node` (`catalog:effect`) for integration tests that provide a real `FileSystem`.

Peer closure holds — `effect` has no peers, and each `@effected/*` edge declares only `effect`. Note that `@effect/platform-node` exports no `NodeContext` aggregate in v4 (the aggregate is `NodeServices`), and `NodeFileSystem.layer` alone does not satisfy `FileSystem | Path` — a real platform wiring composes `Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)`.

The `ConfigResolver` upward-walk strategies (`upwardWalk`, `rootAnchored`, and through it `gitRoot`/`workspaceRoot`) are expressed over [`@effected/walker`](walker.md#consumer-relationship)'s primitives (`Walker.ascend`, `Walker.findUpward`, `Walker.findRoot`), so this package has no walk-up loop of its own. Walker is boundary tier but does not propagate ([R3](../effect-standards.md#dependency-policy)).

## Module layout

Per the [module-per-concept standard](../effect-standards.md#module-layout-module-per-concept); every public name is a file name, every non-entrypoint module imports explicitly — no barrels, no re-export facades, no namespace objects. See `src/`:

- `ConfigFile.ts` — the service (`ConfigFile.Service` factory, `ConfigFile.layer`, `ConfigFileOptions`, Live + Test layers) and its file-level errors.
- `ConfigCodec.ts` — the codec seam (interface only) plus `ConfigCodecError`.
- `JsonCodec.ts` / `JsoncCodec.ts` / `YamlCodec.ts` / `TomlCodec.ts` — the four free-standing codecs, one module each.
- `EncryptedCodec.ts` — the AES-GCM decorator codec, key model (`CryptoKey | Passphrase`) and `ConfigEncryptionError`.
- `ConfigMigration.ts` — migration steps, `VersionAccess`, `ConfigMigrationError`.
- `ConfigResolver.ts` — the resolver seam and its statics (`explicitPath`, `staticDir`, `upwardWalk`, `workspaceRoot`, `gitRoot`, `systemEtc`).
- `MergeStrategy.ts` — the `ConfigSource` model and the `firstMatch` / `layeredMerge` statics.
- `ConfigEvent.ts` — the event payload union, `ConfigEvent` class and the `ConfigEvents` service/layer.
- `ConfigProvider.ts` — the additive v4 `ConfigProvider` integration.
- `internal/deepMerge.ts`, `internal/crypto.ts` — the merge and WebCrypto helpers.

`internal/crypto.ts` is kept deliberately clean: `EncryptedCodec` is the strongest future split candidate (WebCrypto orthogonal to config loading), and keeping it isolated keeps that extraction cheap.

## Error model

The error surface is a small `Schema.TaggedErrorClass` ladder, each error defined in the module of the concept that raises it, each carrying structure rather than prose (the `PackageJsonReadError` precedent). See `src/`; the load-bearing ones:

| Error | Owner | Raised by | Payload |
| --- | --- | --- | --- |
| `ConfigFileNotFoundError` | `ConfigFile.ts` | resolution produced zero sources | `searched: ReadonlyArray<ConfigSource>` — its own tag so "no config" is `catchTag`-routable |
| `ConfigFileReadError` / `ConfigFileWriteError` | `ConfigFile.ts` | fs read / write / mkdir failure | `path`, `cause: Schema.Defect()` |
| `ConfigValidationError` | `ConfigFile.ts` | schema decode / custom `validate` | the structured `SchemaIssue` tree (typed under `Schema.Defect()`, since v4 exports an `Issue` type but no `Schema` for it), not `String(SchemaError)` |
| `ConfigCodecError` | `ConfigCodec.ts` | codec `parse` / `stringify` | `codec`, `operation`, `cause: Schema.Defect()` |
| `ConfigEncryptionError` | `EncryptedCodec.ts` | encrypt / decrypt / key derivation | `cause` |
| `ConfigMigrationError` | `ConfigMigration.ts` | version read/write, migration step | `version`, `name`, `cause` |
| `ConfigDefaultPathMissingError` | `ConfigFile.ts` | `save` with no `defaultPath` configured | its own tag, an empty field record (no path exists to report) |

Restrained granularity — each maps to a distinct recovery a caller would make. **Per-method error unions narrow accordingly**, which is the point and what the tests assert: `loadOrDefault` cannot fail with `ConfigFileNotFoundError` (it handles that branch); `write` cannot either (it takes an explicit path); `validate` fails only with `ConfigValidationError`. The codec seam is generic in its error channel, so decorator codecs widen it cleanly (`EncryptedCodec` fails `ConfigCodecError | ConfigEncryptionError`; `ConfigMigration` fails `ConfigCodecError | ConfigMigrationError`) with no variance friction. `SchemaError` is normalized to `ConfigValidationError` at the decode boundary via `Effect.catchTag`, never leaked or stringified.

`save`-without-`defaultPath` is a typed runtime error, not a compile error: `Context.Key<out Identifier, out Shape>` is covariant in `Shape`, so a type encoding "no `save`" would typecheck while the runtime object still had `save` on it — strictly worse than a typed runtime error because it lies about the shape.

**Callback error semantics.** A caller-supplied callback that declares an `Effect` error channel owns its contract; a `throw` from one is a programmer bug and stays a defect. `Effect.suspend` normalizes construction-time throws so all four throw shapes behave identically. The distinguishing rule: **does the callback's result participate in the operation's result?** `options.validate` does, so a throw there is a defect; the event `emit` hook does not (its result is discarded), so a throw there is absorbed via `Effect.catchDefect` and logged, keeping the "events never break the pipeline" contract.

## Service API and per-schema identity

Each config schema gets a uniquely-keyed service so multiple typed config services coexist in one layer graph. The form is a generic class factory the consumer extends — identity and shape in one consumer-owned artifact:

~~~ts
class AppShape extends Schema.Class<AppShape>("AppShape")({ port: Schema.Number }) {}
class AppConfig extends ConfigFile.Service<AppConfig, AppShape>()("app/Config") {}

const layer = ConfigFile.layer(AppConfig, {
  schema: AppShape,
  codec: JsonCodec,
  resolvers: [ConfigResolver.upwardWalk(".apprc"), ConfigResolver.systemEtc("app")],
  strategy: MergeStrategy.firstMatch,
});
~~~

Options are supplied to `ConfigFile.layer`, **not baked into the factory**, for two reasons: resolver requirements must flow into the layer's `R` (below), and the scoped `Test` layer needs to vary options freely against the same service identity.

The service surface is `load` / `loadFrom` / `loadOrDefault` / `discover` / `save` / `write` / `update` / `validate`, keeping the `save` (default path + `mkdir -p`) versus `write` (explicit path, no mkdir) distinction, with `update` = load → transform → save. `loadOrDefault` returns its `defaultValue` as-is, applying neither the schema nor a configured `validate` to it. `discover` **aborts** on a found-but-corrupt low-priority source rather than skipping it — silently continuing would run the pipeline on a different, wrong configuration than the one closest to the caller's intent.

A deferred DX idea: a `ConfigFile.Service<Self>()(id, schema)` form taking the schema on the class and inferring `A` from it, deleting the duplicate `schema` option and the `typeof X.Type` ceremony. It is a small cycle rather than a patch — the schema would move to the class-definition site while the rest of the options stay on `layer`, and the inference needs probing against the covariant `Context.Key` shape — so it is not folded in yet.

## R-channel type safety

Resolver and `defaultPath` requirements **flow into the layer's `R` type** rather than being cast away. `ConfigResolver<R>` is generic in its requirements; `ConfigFile.layer` unions them, so a consumer supplying a resolver that needs a custom service gets that requirement surfaced on the layer, not a runtime surprise. `Path` is a boundary requirement alongside `FileSystem` — every resolver requires it and the consumer's platform layer satisfies it once, giving `Layer<Service, never, FileSystem | Path>` as a proof.

`ConfigFile.layer`'s resolver-requirements type parameter defaults to `never`, so `resolvers: []` with no `defaultPath` does not infer `unknown` and surface a misdirected `TS2375`. `MergeStrategy.resolve` takes a non-empty source list (`readonly [T, ...T[]]`), so both strategies collapse their error channel to `never` — emptiness is the pipeline's concern, raised as `ConfigFileNotFoundError` before a strategy is invoked.

## ConfigProvider integration

`asConfigProvider` (and `layerConfigProvider`) exposes the loaded, merged document as a v4 `ConfigProvider`, so consumers read it through standard `Config.string(...)` accessors and layer it beneath env-var providers. `MergeStrategy.firstMatch` maps onto provider fallback, `layeredMerge` onto provider merge. This is strictly **additive**, exported from its own concept file so it never becomes a required import — the schema-validated whole-document `load` stays the primary API, and v4 `Config` has no schema-validated document story.

Two shape facts govern the integration: `ConfigProvider.fromUnknown` does not flatten nested objects, so nested keys are read with `Config.nested("db")(Config.string("host"))` and `asConfigProvider` needs no flattening step; and it exposes **decoded leaves**, which has documented edge cases — it accepts only `string | number | boolean | bigint` leaves, so a present `Date`-typed field and a genuinely missing key produce byte-identical `Config.string(...)` diagnostics. Encoding through the schema first was rejected because it would reintroduce the exact coupling this module exists to avoid; the caveat is documented on `asConfigProvider`'s TSDoc rather than fixed.

## The four codecs

Each codec is a thin `ConfigCodec` implementation over one format package. See `src/`:

- **`JsonCodec`** — the zero-dependency built-in over `JSON.parse`/`JSON.stringify`.
- **`JsoncCodec`** — over `@effected/jsonc`, which has no `stringify` (its encode is `JSON.stringify`), so **JSONC comments never survive a decode/encode round-trip** and `JsoncCodec.stringify` is byte-identical to `JsonCodec.stringify`. `JsoncEdit`/`JsoncModifier` cannot help, because they are edit-based and need the *original* source text while `ConfigCodec.stringify`'s seam is stateless (`(value) => Effect<string, E>`). A comment-preserving write would require the seam itself to accept the prior raw text as input — an open question recorded, not resolved.
- **`YamlCodec`** — over `@effected/yaml`, which has a real `stringify`; no comment-loss caveat.
- **`TomlCodec`** — over `@effected/toml`, which has a real `stringify`. Unlike its siblings it has a cheap genuine stringify failure (TOML has no null), so it is the one codec whose tests pin `operation: "stringify"` with a structural cause. Its hostile-input test trips `@effected/toml`'s parse-side nesting-depth cap and asserts typed failure (`Cause.hasFails`, not `hasDies`). TOML date-times and large integers decode to their `TomlDateTime` classes and `bigint`; the seam is `unknown`, so the consumer's schema decides.

## Merge and hardening properties

`internal/deepMerge.ts` (behind `MergeStrategy.layeredMerge`) runs over the **decoded** source values, so two properties are load-bearing:

- **Value identity is preserved.** `deepMerge` builds its result on `target`'s prototype (`Object.create(Object.getPrototypeOf(target))`), so a decoded `Schema.Class` document survives as a real instance with its getters intact and still encodes through the schema. `isPlainObject` narrows to a true plain object (prototype `Object.prototype` or `null`) to gate recursion, so nested `Date`/`Map`/`Set`/`RegExp`/class instances are **atomic** — the highest-priority source that defines one wins it whole. (`Object.prototype.toString` cannot discriminate here — `Schema.Class`, `DateTime` and `Option` all report `[object Object]`; only the prototype test is safe.) Because each source is decoded individually before the strategy sees it, `layeredMerge` overrides values across tiers but cannot fill a field missing from a source (that source would fail its own decode first).
- **Prototype-pollution safe.** A prototype-preserving merge and a pollution guard interact: preserving the prototype means `result` inherits `Object.prototype`'s `__proto__` accessor, so any write through `[[Set]]` can move the prototype. `deepMerge` filters both sides through a `FORBIDDEN` set and copies every key with `Object.defineProperty` (an own data property that never consults the prototype chain) — never `Object.assign`, whose `[[Set]]` semantics reassign the prototype on a hostile `__proto__` key.

Three more current-state properties:

- **`update` serializes its read-modify-write** with a one-permit `Semaphore` (`Semaphore.makeUnsafe(1)`, one per service instance) so two concurrent calls do not silently drop one's change. This guards one service instance in one process; it is not a file lock.
- **`rootAnchored` no longer aborts on one unreadable ancestor.** `Walker.findUpward` absorbs each probe individually, so an `EACCES` on an ancestor is skipped and the walk continues — the resolver-absorption contract becomes a property of the walk rather than the wrapper.
- **PBKDF2 runs at 600,000 iterations** (OWASP's current PBKDF2-HMAC-SHA256 guidance), the one deliberate divergence from a verbatim crypto port; derivation is memoized per codec instance via `Effect.cachedInvalidateWithTTL(key, Duration.infinity)` + `Effect.onExit` invalidation, so a failed or interrupted derivation is retried rather than replayed (plain `Effect.cached` would brick the instance by replaying an `Interrupt` forever).

## Observability

Per the [observability standard](../effect-standards.md#observability-standards): `Effect.fn` named spans on every public fallible service method, plus `Effect.withSpan` around the codec-parse and resolver-probe sub-steps that dominate latency. The PubSub event system remains a consumer-facing hook — opt-in via an optional `events` tag, honestly zero-cost when absent (`emit` is `Effect.void`). An event variant is emittable iff the step it reports has a non-`never` error channel (so `StringifyFailed` is kept — `ConfigCodec.stringify` is consumer-implemented and can fail — while `DiscoveryFailed` is dropped, since discovery's resolution step is `never` under the absorption contract). The library stays telemetry-agnostic — applications compose `@effect/opentelemetry` at the edge.

## Testing

`@effect/vitest` with `it.effect` as the default mode, shared wiring via top-level `layer(...)` groups; tests in `__test__/` split per concept, integration under `__test__/integration/`.

- **Error-path tests via `Exit`/`Cause` inspection** — the centerpiece: each tag is reached by a distinct failure, `cause` is preserved structurally, `ConfigValidationError` carries the schema issue not a string, and type-level assertions confirm the narrowed per-method unions. (`Cause.hasFails`/`hasDies`/`hasInterrupts` distinguish failure shape, since `Exit.getCause` returns `Option<Cause<E>>`.)
- **Pipeline-composition tests** — the decorator stack round-trips and each decorator's widened error channel surfaces the right tag.
- **Resolver tests** — the error-absorbing policy as a contract (a permission-denied on one tier yields `Option.none()` and never aborts the chain), with integration tests over real platform layers.
- **Merge-strategy, `Test`-layer and `asConfigProvider` tests** — including the fixed `sources` reporting under `layeredMerge`, the prototype-preservation and pollution-guard probes, and provider composition with `ConfigProvider.fromEnv`.

Integration tests are the only ones that provide a platform layer — the boundary discipline made explicit.

## Watcher (deferred)

`@effected/config-file-watcher` is a separate, not-yet-started boundary-tier package on its own cycle because it needs design, not translation: change detection should be `Equal`/schema-derived equivalence rather than a `JSON.stringify` comparison; a config file that becomes **corrupt** must be distinguishable from one that was **deleted** (a typed error versus an absence); fiber interruption replaces the un-Effect-ish `AbortSignal`; and it should offer `FileSystem.watch` alongside polling. It is not on the release gate.
