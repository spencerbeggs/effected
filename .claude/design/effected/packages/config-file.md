---
status: draft
module: effected
category: architecture
created: 2026-07-08
updated: 2026-07-08
last-synced: 2026-07-08
completeness: 70
related:
  - ../architecture.md
  - ../effect-standards.md
  - ../migration-playbook.md
  - ../package-inventory.md
  - jsonc.md
  - yaml.md
  - package-json.md
---

# @effected/config-file design

## Overview

Target design for `@effected/config-file`, the **fifth** package migration (step 2 of [migration-playbook.md](../migration-playbook.md)) and the **second boundary-tier port** after [package-json.md](package-json.md). Source is config-file-effect (`/Users/spencer/workspaces/spencerbeggs/config-file-effect`, v0.3.0, Effect v3); the step-1 analysis is `.claude/reviews/config-file.md` and this design implements its §3 v4-mapping, §4 layout, §5 split recommendation and §6 peer findings against [effect-standards.md](../effect-standards.md).

Like the four ports before it this is a redesign, not a lift-and-shift, and it is **v4-native throughout — no v3 pattern is preserved merely because v3 shipped it**.

What survives: the **codec × resolver × strategy** pipeline decomposition (review §1, "a genuinely good factoring"), the codec decorator pattern (`EncryptedCodec` and `ConfigMigration` each wrap a `ConfigCodec` and return one, so encryption + migrations + format compose freely), the error-absorbing resolver policy (`Effect<Option<string>>` with *all* failures caught to `Option.none()` so a permission-denied on one tier never aborts the chain), the scoped `Test` layer that seeds files and runs the **real** pipeline underneath rather than a parallel mock, opt-in zero-cost events, and per-schema service identity.

What does not: the one stringly-typed mega-error, the nine kind-based `src/` folders, the `Base`/`Impl` export leakage, the namespace const-objects simulating classes, the `any`-cast R channel, the internal `Effect.provide(Path.layer)` boundary violation, and the plain-vitest harness.

The **headline migration work is the error-model redesign** (review §"Priority recommendations", item 2) — the single biggest quality lift in this port.

Status: **designed, not yet implemented.** Playbook steps 1–2 complete; step 3 (port) is next.

## Scope and the package set

The maintainer ruled that **subpath exports are not used in this monorepo** — an optional dependency becomes a package boundary instead. That decision, plus the review's split analysis (§5), expands migration #5 from one package into a family. Only the first three ship in this cycle.

| Package | Tier | Cycle | Depends on |
| --- | --- | --- | --- |
| `@effected/config-file` | boundary | **this one** | `effect` (peer) only |
| `@effected/config-file-jsonc` | boundary | **this one** | `@effected/jsonc`, `@effected/config-file` |
| `@effected/config-file-yaml` | boundary | **this one** | `@effected/yaml`, `@effected/config-file` |
| `@effected/toml` | pure | own cycle | — |
| `@effected/config-file-toml` | boundary | own cycle | `@effected/toml`, `@effected/config-file` |
| `@effected/config-file-watcher` | boundary | own cycle | `@effected/config-file` |

Three decisions are load-bearing here and were ruled on directly:

1. **`@effected/toml` is built at full parity with jsonc/yaml** — a zero-runtime-dependency internal engine with the CST/edit/format/visitor pipeline, not a `smol-toml` wrapper. `@effected/yaml` and `@effected/jsonc` both carry zero runtime dependencies and a ported-with-attribution internal engine; a `smol-toml` runtime dep would make TOML the first `@effected` format package to break that property. This is a format-library migration on the scale of the yaml port and gets **its own spec → plan → implement cycle**.
2. **config-file's core does not wait on it.** Only the *toml adapter* depends on `@effected/toml`; the core pipeline needs nothing from it. Sequencing config-file behind a multi-week parser project would also mean designing `TomlFromString` with no known consumer. So config-file lands first against a stable `ConfigCodec` seam, and the toml adapter is a ~20-line follow-on.
3. **The watcher becomes `@effected/config-file-watcher`**, in the family but on its own cycle. It needs genuine redesign (see [watcher redesign](#watcher-redesign-deferred-cycle)) rather than a port-then-rewrite.

Dependency direction stays strictly acyclic: **config-file → format packages, never the reverse.** The format packages stay pure and unaware of config-file; the adapters are the only things that know about both.

## Tier and dependencies

**Boundary tier.** The v3 posture is already correct (review §1): all IO goes through platform `FileSystem`/`Path` abstractions and the package never touches `node:fs`. That survives — but in v4 those abstractions live in `effect` core, so the boundary gets *cheaper*, not more expensive.

`@effected/config-file`:

- `peerDependencies`: `effect` only (`catalog:effect`). **The v3 `@effect/platform` peer disappears entirely** — `FileSystem` and `Path` are core in v4 (verified against `effect@4.0.0-beta.93`; `packages/package-json/src/PackageJsonFile.ts` sets the precedent with `import { FileSystem, Path } from "effect"`). The v3 optional `@effect/platform-node` peer also goes: the library programs against core abstractions and never needs a platform *implementation*, even optionally. Consumers provide one at the edge.
- `dependencies`: **none.** Core carries the zero-dependency JSON codec only; `smol-toml` leaves with the toml codec.
- `devDependencies`: `effect`, `@effect/vitest`, `@effect/tsgo` (`catalog:effect`); `@effect/platform-node` (`catalog:effect` — for `it.effect` integration tests that provide a real `FileSystem`); `@types/node`, `typescript` (`catalog:silk`).

`@effected/config-file-jsonc` / `-yaml`:

- `peerDependencies`: `effect`, `@effected/config-file` (`workspace:*`), and the format package (`@effected/jsonc` / `@effected/yaml`, `workspace:*`). The adapter is ~20 lines of glue between two APIs the consumer already has installed, so both edges are peers rather than regular deps — this keeps a single `ConfigCodec` interface identity and a single format-package instance in the consumer's graph.

**Peer closure check.** `effect` has no peers. `@effected/jsonc` and `@effected/yaml` each declare only `effect` as a peer, which the adapters re-declare alongside `@effected/config-file` (whose peer is likewise `effect` only). The closure holds; no transitive peer escapes to consumers. This is the cleanest boundary profile in the repo so far: **zero runtime dependencies, `effect`-only peers.**

## Module layout (module-per-concept)

Per the [module-per-concept standard](../effect-standards.md#module-layout-module-per-concept), the nine kind-based folders (`codecs/`, `errors/`, `events/`, `layers/`, `migrations/`, `resolvers/`, `services/`, `strategies/`, `watcher/` — several holding a single ~36-line file) collapse to concept files. Every public name is a file name.

~~~text
src/
  index.ts             # public surface, re-exports only
  ConfigFile.ts        # the service: ConfigFile.Service factory, ConfigFile.layer,
                       #   ConfigFileOptions, Live + Test layers; ConfigFileNotFoundError,
                       #   ConfigFileReadError, ConfigFileWriteError, ConfigValidationError
                       #   — replaces services/ConfigFile.ts, layers/ConfigFileLive.ts,
                       #   layers/ConfigFileTest.ts, errors/ConfigError.ts
  ConfigCodec.ts       # the codec seam + ConfigCodecError; ConfigCodec.json is the only
                       #   built-in (zero-dep) — replaces codecs/ConfigCodec.ts, JsonCodec.ts,
                       #   codecs/TomlCodec.ts, errors/CodecError.ts
  EncryptedCodec.ts    # AES-GCM decorator codec, key model (CryptoKey | Passphrase),
                       #   ConfigEncryptionError
  ConfigMigration.ts   # migration steps, VersionAccess, ConfigMigrationError
  ConfigResolver.ts    # the resolver seam; six statics: ConfigResolver.explicitPath,
                       #   .staticDir, .upwardWalk, .workspaceRoot, .gitRoot, .systemEtc
  MergeStrategy.ts     # rename of ConfigWalkStrategy; ConfigSource model;
                       #   statics MergeStrategy.firstMatch, MergeStrategy.layeredMerge
  ConfigEvent.ts       # payload union + ConfigEvent class + the ConfigEvents service/layer
                       #   (merges events/ConfigEvent.ts + events/ConfigEvents.ts)
  ConfigProvider.ts    # additive v4 integration: ConfigFile.asConfigProvider
  internal/
    walkUp.ts          # the shared ascend-until-root iteration (UpwardWalk, GitRoot and
                       #   WorkspaceRoot each hand-roll this today)
    deepMerge.ts
    crypto.ts          # PBKDF2 derivation, IV framing, base64 helpers
~~~

Nine folders + 17 files collapse to **9 concept files + 3 internal helpers**. Every non-entrypoint module imports explicitly from defining modules — no barrels, no re-export facades.

`internal/crypto.ts` is kept deliberately clean: `EncryptedCodec` is the strongest future split candidate (~230 lines of WebCrypto orthogonal to config loading), and the design keeps that extraction cheap without paying for a package that has one consumer today.

## Error redesign

**This is the headline work.** v3's `ConfigError { operation: string; path?: string; reason: string }` absorbs every failure in the pipeline — fs read, codec parse, schema decode, custom validate, empty resolution, save-without-defaultPath — via `Effect.mapError((e) => new ConfigError({ ..., reason: String(e) }))`. Three consequences (review §2):

- `catchTag("ConfigError")` cannot distinguish "no config found" from "TOML syntax error" without string-matching the open-ended `operation` field. The v3 README's own recovery example catches everything.
- Structured causes are destroyed. A `CodecError` with codec/operation fields becomes `reason: "CodecError: ..."`; a `ParseError` from schema decode becomes a giant string. This directly violates the standards' *never collapse errors to string/unknown early* and *wrap foreign errors with a `cause` field*.
- `ConfigMigration` compounds it: migration failures are re-wrapped into `CodecError` with hand-assembled reason strings (`migration "x" (v2) failed: ...`) because the wrapper must still satisfy `ConfigCodec` — the codec interface's error channel is *forcing* information loss.

The replacement is a small `Schema.TaggedErrorClass` ladder, each error defined in the module of the concept that raises it, each carrying structure rather than prose. This follows the `PackageJsonReadError` precedent already shipped in `packages/package-json`.

| Error | Owner module | Raised by | Payload |
| --- | --- | --- | --- |
| `ConfigFileNotFoundError` | `ConfigFile.ts` | resolution produced zero sources | `searched: ReadonlyArray<ConfigSource>` — its own tag so "no config" is `catchTag`-routable |
| `ConfigFileReadError` | `ConfigFile.ts` | fs read failure | `path`, `cause: Schema.Defect()` |
| `ConfigFileWriteError` | `ConfigFile.ts` | fs write / mkdir failure | `path`, `cause: Schema.Defect()` |
| `ConfigValidationError` | `ConfigFile.ts` | schema decode / custom `validate` | the **structured schema issue**, not `String(ParseError)` |
| `ConfigCodecError` | `ConfigCodec.ts` | codec `parse` / `stringify` | `codec`, `operation: "parse" \| "stringify"`, `cause: Schema.Defect()` |
| `ConfigEncryptionError` | `EncryptedCodec.ts` | encrypt / decrypt / key derivation | `cause` — retires the `"key-derivation"` string leaking into the generic codec error |
| `ConfigMigrationError` | `ConfigMigration.ts` | version read/write, migration step | `version`, `name`, `cause` — no more reason-string assembly |

Seven errors for genuinely distinct recovery paths. This is restrained granularity, not proliferation: each maps to a decision a caller would actually make differently.

**Per-method error unions narrow accordingly** — this is the point of the exercise, and the property the tests assert:

- `loadOrDefault` **cannot** fail with `ConfigFileNotFoundError` (that is the branch it handles).
- `write` **cannot** fail with `ConfigFileNotFoundError` (it takes an explicit path).
- `validate` fails only with `ConfigValidationError`.

**Codec seam error channel.** `ConfigCodec.parse`/`stringify` fail with `ConfigCodecError`. The decorator codecs widen it: `EncryptedCodec` fails with `ConfigCodecError | ConfigEncryptionError`, `ConfigMigration` with `ConfigCodecError | ConfigMigrationError`. The v3 forcing-function — every decorator must flatten into the base codec's single error type — disappears because the seam is generic in its error channel.

**Structure-preserving discipline.** `SchemaError` is normalized to `ConfigValidationError` at the decode boundary via `Effect.catchTag("SchemaError", …)`, never leaked deep into logic and never stringified.

## Service API and per-schema identity

v3's `ConfigFile.Tag<A>(id)` produces a uniquely-keyed tag per config schema so multiple typed config services coexist in one layer graph. The *need* is real; only the `Context.GenericTag` mechanism is dated (review §1).

The v4 form is a generic class factory the consumer extends — identity and shape in one consumer-owned artifact, matching the `Context.Service` standard:

~~~ts
class AppShape extends Schema.Class<AppShape>("AppShape")({ port: Schema.Number }) {}
class AppConfig extends ConfigFile.Service<AppConfig, AppShape>()("app/Config") {}

const layer = ConfigFile.layer(AppConfig, {
  schema: AppShape,
  codec: ConfigCodec.json,
  resolvers: [ConfigResolver.upwardWalk(".apprc"), ConfigResolver.systemEtc("app")],
  strategy: MergeStrategy.firstMatch,
});
~~~

**Verified against `effect@4.0.0-beta.93`** before adoption: `Context.Service<Self, Shape>()(id)` composes under a generic factory, `A` flows through the service methods, two independently-keyed config services coexist in one layer graph, and a deliberate `number`→`string` negative check errors as it should. The probe typechecked under the package's real tsconfig with `tsgo`.

Options are supplied to `ConfigFile.layer`, **not baked into the factory**. Two reasons: resolver requirements must flow into the layer's `R` (see below), and the scoped `Test` layer needs to vary options freely against the same service identity — baking them into the class-definition site would freeze them.

The service surface is otherwise preserved (review §1 calls it "a well-scoped set"): `load` / `loadFrom` / `loadOrDefault` / `discover` / `save` / `write` / `update` / `validate`, keeping the documented `save` (default path + `mkdir -p`) versus `write` (explicit path, no mkdir) distinction, and `update` = load → transform → save.

## Type-safety debt paid

v3 systematically casts the R channel away rather than flowing it, so the layer's declared type `Layer<Service, never, FileSystem>` is *a claim, not a proof*:

- `resolvers: ReadonlyArray<ConfigResolver<any>>`, then `Effect.provideService(resolver.resolve, FileSystem.FileSystem, fs) as Effect.Effect<Option<string>>` — an unchecked assertion that `FileSystem` is the only requirement a resolver can have.
- `defaultPath?: Effect<string, ConfigError, any>` with a literal `// cast away R here` comment inside `save`.
- `FirstMatch` / `LayeredMerge` are `ConfigWalkStrategy<any>` singletons.

The redesign **flows resolver and `defaultPath` requirements into the layer's `R` type**. `ConfigResolver<R>` is generic in its requirements; `ConfigFile.layer` unions them, so a consumer supplying a resolver that needs a custom service gets that requirement surfaced on the layer instead of a runtime surprise.

Separately, **`Path` becomes a boundary requirement.** Every v3 resolver (and the Live and Test layers) calls `Effect.provide(Path.layer)` internally — the standards say provide at boundaries only. `Path` joins `FileSystem` as a requirement the consumer's platform layer satisfies once, giving `Layer<Service, never, FileSystem | Path>` as a *proof*.

## ConfigProvider integration (additive)

v4 overhauled `Config`/`ConfigProvider` into a simpler key-value provider model with composition and fallback. Verified present in `effect@4.0.0-beta.93`: `ConfigProvider.fromUnknown`, `orElse`, `layerAdd`, `fromEnv`, `fromDir`, `fromDotEnv`.

This creates an integration the v3 library could not have. `ConfigFile.asConfigProvider` exposes the **loaded, merged document** as a `ConfigProvider`, so consumers read it through standard `Config.string("port")` accessors and layer it beneath env-var providers (env → project file → git-root file → `/etc`). `MergeStrategy.firstMatch` maps naturally onto provider fallback; `layeredMerge` onto provider merge.

**The schema-validated whole-document `load` stays the primary API.** That is this package's core value and v4 `Config` has no schema-validated document story — `ConfigProvider.fromDir` reads a directory of files as key-value pairs, which is a different capability. The provider integration is strictly additive, exported from its own `ConfigProvider.ts` concept file so it never becomes a required import.

## Pruning and naming fixes

Dead surface removed (review §2):

- **`ConfigCodec.extensions`** — declared on every codec and never read by the pipeline. Dropped (YAGNI); resolvers already own path construction.
- **Event variants `Stringified` and `ResolutionFailed`** — defined in the union, never emitted. Dropped.
- **`ConfigFileMigration.down`** — defined, never invoked. Dropped.
- **`ConfigErrorBase` / `CodecErrorBase`** — exported *solely* as a declaration-bundling workaround, i.e. public API that exists for the build tool. The need is met by the inline factory + narrow `_base` suppression in `savvy.build.ts` per the [API-Extractor house policy](../effect-standards.md#api-extractor--effect-class-factories); no `*_base` symbol is exported.
- **`load` / `loadOrDefault` copy-paste** — `resolveAndEmit` exists but `loadOrDefault` re-inlines it. One implementation.
- **The thrice-hand-rolled walk-up loop** (`UpwardWalk`, `GitRoot`, `WorkspaceRoot`) — moves to `internal/walkUp.ts`.

Naming (review §2, "misleading names"):

- **`ConfigWalkStrategy` → `MergeStrategy`.** It is a merge/selection strategy and never walks anything; the thing that walks is the `UpwardWalk` *resolver*.
- **`ConfigSource.tier` → `ConfigSource.resolver`.** It holds the resolver's name, and "tier" is never defined anywhere in the v3 codebase.

Event-semantics fixes (review §2, "event semantics are approximate"):

- `Resolved` / `Loaded` report `sources[0].path`, which is **wrong under `layeredMerge`** where every source contributed. They carry the full `sources` array.
- `update` emits `Written` + `Saved` + `Updated` for one call. It emits `Updated` only — event granularity is designed per-operation rather than bolted on.

## Observability plan

v3 has zero `Effect.withSpan` / `Effect.fn` / `Effect.log*` anywhere; the custom PubSub event system is partially reinventing tracing (review §2).

Per the [observability standard](../effect-standards.md#observability-standards): `Effect.fn("ConfigFile.load")` named spans on every public *fallible* service method (`load`, `loadFrom`, `loadOrDefault`, `discover`, `save`, `write`, `update`, `validate`), plus `Effect.withSpan` around the codec-parse and resolver-probe sub-steps that dominate latency.

The PubSub event system **remains as a consumer-facing hook** — it is opt-in via an optional `events` tag and honestly zero-cost when absent (`emit` is `Effect.void`), which review §1 credits as good design. It is no longer the *only* observability channel. The library stays telemetry-agnostic: no OTel configuration anywhere; applications compose `@effect/opentelemetry` at the edge.

## Testing strategy

All v3 tests are `it()` + `Effect.runPromise` / `runPromiseExit` with layers re-provided per test body — the anti-pattern the standards ban. Coverage breadth is good (~1.8k lines, integration tests with real fixtures), so **the cases port well and the harness is rewritten**; the migration cost is mechanical, not conceptual.

`@effect/vitest` with `it.effect` as the default mode, shared wiring via top-level `layer(...)` groups.

- **Error-path tests via `Exit`/`Cause` inspection** — the centerpiece, because the error redesign is the headline work. Each of the seven tags is reached by a distinct failure; `cause` is preserved structurally rather than stringified; `ConfigValidationError` carries the schema issue, not a string. Type-level assertions that `loadOrDefault` cannot fail with `NotFound` and `write` cannot fail with `NotFound`.
- **Pipeline-composition tests** — the decorator stack `ConfigMigration.make({ codec: EncryptedCodec(ConfigCodec.json, key), migrations })` round-trips, and each decorator's widened error channel surfaces the right tag.
- **Resolver tests** — the error-absorbing policy is a *contract*: a permission-denied on one tier must yield `Option.none()` and never abort the chain. Integration tests with real `NodeFileSystem.layer` cover `gitRoot` / `workspaceRoot` / `systemEtc` against fixture trees.
- **Merge-strategy tests** — `firstMatch` versus `layeredMerge`, including the fixed `sources` reporting under `layeredMerge`.
- **`Test` layer tests** — the scoped seed-and-finalize behavior, asserting it runs the real Live implementation underneath.
- **`asConfigProvider` tests** — a loaded document read back through `Config.string(...)`, and `ConfigProvider.orElse` composition with `ConfigProvider.fromEnv`.

Tests live in `packages/config-file/__test__/` split per concept, integration under `__test__/integration/`, per repo convention. Integration tests are the only ones that provide a platform layer — the boundary discipline made explicit.

## v4 API drift to verify early

The discipline (semver was burned mid-port by v4 removing `SortedSet`): verify the exposed v4 surface *before* committing. Already verified during this design against `effect@4.0.0-beta.93`:

- **`FileSystem` / `Path` are in `effect` core** — confirmed by runtime probe and by `packages/package-json/src/PackageJsonFile.ts` importing them from `effect`. The `@effect/platform` peer is genuinely gone.
- **`ConfigProvider` surface** — `fromUnknown`, `orElse`, `layerAdd`, `fromEnv`, `fromDir`, `fromDotEnv` all present.
- **The generic `Context.Service` class factory** typechecks under `tsgo`, with `A` flowing through and independent keying holding.

Remaining to verify at port time, each resolving to an as-built note:

- **`Schema.TaggedErrorClass` with a structured schema-issue payload** — the exact v4 type for `ConfigValidationError`'s issue field (`SchemaIssue.InvalidValue`? the `SchemaError` itself under `Schema.Defect()`?), and whether it annotates cleanly for a zero-warning `issues.json`.
- **`PubSub` / `Stream` / `Ref` / `Schedule` / `DateTime`** surfaces — all present in v4, expected mechanical, but the `Schema.DateTimeUtc` field on `ConfigEvent` needs its v4 spelling confirmed.
- **Generic error channel on the codec seam** — that `ConfigCodec<A, E>` composes through the decorators without variance friction under `tsgo`.
- **`ConfigProvider.fromUnknown` semantics** — how it flattens nested objects into keys, which determines whether `asConfigProvider` needs a path-flattening step.
- **WebCrypto under v4/NodeNext** — `crypto.subtle` typing for the AES-GCM and PBKDF2 paths, and the Windows-safe `BufferSource` copies v3 carefully handles.

## Port strategy

~1.6k lines of source plus ~1.8k lines of tests. No hot recursive engine — the risk is concentrated in the error redesign rippling through every method signature, and in the R-channel flow replacing the `any` casts. Sequencing:

1. **Scaffold** the boundary package per [package-setup.md](../package-setup.md) (copy `packages/package-json`; set `name`, `repository.directory`, the model paths). `pnpm install`, then **check `git diff pnpm-lock.yaml`** for the optional-binary-pruning footgun.
2. **Port the seams first** — `ConfigCodec` (with its generic error channel), `ConfigResolver<R>`, `MergeStrategy`, and their errors. These are small interfaces; getting the error channel and the `R` parameter right here is what makes the rest fall out.
3. **Port `ConfigResolver`'s six statics** over `internal/walkUp.ts`, and `MergeStrategy`'s two over `internal/deepMerge.ts`. Assert the error-absorbing contract before anything depends on it.
4. **Port `ConfigFile`** — the service factory, `ConfigFile.layer` with flowed `R`, the eight methods with narrowed error unions, then the `Test` layer. This is the design-risk center.
5. **Port the decorators** — `ConfigMigration`, then `EncryptedCodec` over `internal/crypto.ts`.
6. **Port `ConfigEvent`** (pruned variants, fixed `sources` reporting) and add `ConfigProvider.ts`.
7. **Rewrite the tests** to `@effect/vitest`; the integration fixtures port directly.
8. **Then the adapters** — `@effected/config-file-jsonc` and `@effected/config-file-yaml`, once the `ConfigCodec` seam is stable.
9. **Build gate:** `pnpm --filter @effected/config-file typecheck`, `turbo build:prod` with a zero-warning `dist/prod/issues.json`, biome clean, tests green.

## Watcher redesign (deferred cycle)

`@effected/config-file-watcher` ships on its own cycle because it needs design, not translation (review §2, "watcher weaknesses"):

- Change detection is a `JSON.stringify` comparison. It becomes `Equal` / schema-derived equivalence.
- `loadFrom` failures are swallowed to `Option.none()`, so a config file that becomes **corrupt** is indistinguishable from one that was **deleted**. The redesign surfaces the distinction — corruption is a typed error the consumer sees; deletion is an absence.
- The `AbortSignal` option is un-Effect-ish; fiber interruption already covers it. Dropped.
- Polling-only, though `FileSystem.watch` exists on the platform abstraction. The redesign offers both.
- Its tests use real-time sleeps; they move to `TestClock.adjust`.

## Deliberately not ported

- **The `ConfigError` mega-error** — seven tagged errors with structured `cause` fields and narrowed per-method unions.
- **`ConfigErrorBase` / `CodecErrorBase` public exports** — inline factory + narrow `_base` suppression.
- **The namespace const-objects** (`ConfigFile = { Tag, Live, Test }`, `ConfigEvents`, `ConfigWatcher`, `ConfigMigration`, `VersionAccess`) — v4 classes and statics.
- **`makeConfigFileLiveImpl` / `ConfigFileTestImpl` exports** — the `Impl` leakage disappears when three files (service interface, live layer, test layer) become one concept file.
- **The nine kind-based folders** — nine concept files + `internal/`.
- **`ConfigWalkStrategy`, `ConfigSource.tier`** — `MergeStrategy`, `ConfigSource.resolver`.
- **`ConfigCodec.extensions`, the `Stringified` and `ResolutionFailed` events, `ConfigFileMigration.down`** — dead surface.
- **`ConfigResolver<any>` and the `as Effect.Effect<Option<string>>` casts** — requirements flow into `R`.
- **Internal `Effect.provide(Path.layer)`** — `Path` is a boundary requirement.
- **The v3 `@effect/platform` and optional `@effect/platform-node` peers** — `FileSystem`/`Path` are core in v4; peers are `effect` only.
- **`smol-toml` as a runtime dependency** — TOML leaves with `@effected/config-file-toml`, backed by a zero-dep `@effected/toml`.
- **Plain-vitest + per-test `Effect.provide`** — `@effect/vitest` `it.effect` + top-level `layer(...)` groups.
- **The `xdg-effect` coupling** — none exists today and none is introduced. XDG-specific resolvers belong in `@effected/xdg`, composed on top of the `ConfigResolver` seam.
