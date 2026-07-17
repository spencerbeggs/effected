# @effected/config-file

Composable config-file loading: a pluggable codec × resolver × strategy pipeline, plus encryption/migration decorators and a `ConfigProvider` bridge. Boundary tier: all IO through core `FileSystem`/`Path`, zero external runtime deps — format engines arrive only through the `@effected/jsonc`/`yaml`/`toml` peers.

## Import

```ts
import {
 ConfigFile,
 ConfigResolver,
 JsonCodec, // or JsoncCodec / YamlCodec / TomlCodec — import ONLY the one you use
 MergeStrategy,
} from "@effected/config-file";
```

**Platform**: `ConfigFile.layer` does real IO — provide `FileSystem` and `Path` once at the edge, `@effect/platform-node` or `@effect/platform-bun` (wired in the example below). The codecs, resolvers and strategies are plain values.

Single entrypoint, flat named exports. **Never collect the codecs into a namespace object** (`const Codecs = { JsonCodec, YamlCodec }`-style): referencing such an object reaches every codec and drags every parsing engine into the bundle — tree-shaking dies silently. Import the specific named codec.

## Core API

- **Pipeline seams** — `ConfigCodec<E = ConfigCodecError>` (type-only interface, `{ name, parse(raw), stringify(value) }`, bytes ⇄ document, generic in its error so decorators widen rather than flatten); `ConfigResolver<R>` with statics `explicitPath(target)` (the one bare-string signature), `staticDir({ dir, filename })`, `upwardWalk({ filename, cwd?, stopAt?, subpaths? })`, `workspaceRoot({ filename, cwd?, subpaths? })`, `gitRoot({ filename, cwd?, subpaths? })`, `systemEtc({ app, filename, dir? })` — each `resolve` has error channel `never`, absorbing fs failures into `Option.none()`; `MergeStrategy.firstMatch()` / `MergeStrategy.layeredMerge()`, each `<A>()` generic over the decoded type.
- **`ConfigFile.Service<Self, A>()(id)`** — a per-schema `Context.Service` class factory you extend for identity; `ConfigFile.layer(TagClass, { schema, codec, resolvers, strategy, validate?, defaultPath?, events? })` wires it (`schema` is a `Schema.Codec<A, I>`, not a plain `Schema.Schema<A>` — the encoded form `I` matters on the write path). Service surface: `load`, `loadFrom(path)`, `loadOrDefault(default)`, `discover` (every source found, in priority order — a corrupt source ABORTS with a typed error rather than being silently skipped), `save` (resolves `defaultPath`, `mkdir -p`s its parent), `write(value, path)` (no directory creation — the path is already vouched for), `update(fn, default?)` (semaphore-serialized read-modify-write), `validate`.
- **The four codecs** — `JsonCodec` (zero-dep, the only one touching no parsing engine), `JsoncCodec` (comments do NOT survive a decode/encode round-trip — its `stringify` calls `JSON.stringify` directly), `YamlCodec` (inherits `@effected/yaml`'s alias-bomb and depth-cap hardening as typed failures), `TomlCodec` (can genuinely fail to stringify — TOML has no null, no out-of-int64 `bigint`, no circular reference). Free-standing consts, one module each — `ConfigCodecError` carries `{ codec, operation: "parse" | "stringify", cause }`.
- **Decorators** — `EncryptedCodec(inner, keySource)` (AES-GCM; `keySource` is `EncryptedCodecKey.fromCryptoKey(effect)` or `.fromPassphrase(passphrase, salt)`, PBKDF2-derived and cached per codec instance) and `ConfigMigration.make({ codec, migrations, versionAccess? })` (`migrations: ConfigFileMigration[]`, each `{ version, name, up(raw) }`; `versionAccess` defaults to a top-level `version` field) — both wrap any `ConfigCodec` and return one, widening the error channel (`ConfigEncryptionError` / `ConfigMigrationError`) rather than flattening it.
- **`ConfigEvents`** — the opt-in, zero-cost-when-absent observability hook: a `Context.Service` wrapping an unbounded `PubSub.PubSub<ConfigEvent>`. Pass the class itself as `ConfigFileOptions.events`; when omitted, `emit` is `Effect.void` and never even looks the service up. `ConfigEvent` is `{ timestamp, event: ConfigEventPayload }`; `ConfigEventPayload` is a ten-case tagged union covering the full lifecycle (`Discovered`, `NotFound`, `Parsed`, `ParseFailed`, `Validated`, `ValidationFailed`, `Resolved`, `Loaded`, `StringifyFailed`, `Written`, `Saved`, `Updated`) — failure variants carry the structured typed error in `error`, never a stringified `reason`.
- **`ConfigProvider` bridge** — `asConfigProvider(loadedDoc)` / `layerConfigProvider(tag, { asPrimary? })` expose a loaded document to core `Config.*` reads. `asPrimary` defaults to `false` (env overrides the file); a missing file is a real `ConfigLoadError`, never a silently-empty provider.

## Usage

```ts
import { ConfigFile, ConfigResolver, JsonCodec, MergeStrategy } from "@effected/config-file";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, Layer, Schema } from "effect";

class AppShape extends Schema.Class<AppShape>("AppShape")({ port: Schema.Number }) {}
class AppConfig extends ConfigFile.Service<AppConfig, AppShape>()("app/Config") {}

const AppConfigLive = ConfigFile.layer(AppConfig, {
 schema: AppShape,
 codec: JsonCodec,
 resolvers: [ConfigResolver.upwardWalk({ filename: ".apprc" }), ConfigResolver.systemEtc({ app: "app", filename: ".apprc" })],
 strategy: MergeStrategy.firstMatch(),
});

const program = Effect.gen(function* () {
 const cfg = yield* AppConfig;
 return (yield* cfg.load).port;
}).pipe(Effect.provide(AppConfigLive), Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)));
```

Wrapping a base codec with encryption or migrations — both are decorators over `ConfigCodec`, so they compose into the same `ConfigFile.layer` call as any other codec:

```ts
import { ConfigMigration, EncryptedCodec, EncryptedCodecKey, JsonCodec } from "@effected/config-file";
import { Effect } from "effect";

// Encrypt at rest; the passphrase-derived key is cached per codec instance.
const salt = new Uint8Array(16); // persist alongside the ciphertext in real use
const SecretsCodec = EncryptedCodec(JsonCodec, EncryptedCodecKey.fromPassphrase(process.env.SECRETS_KEY ?? "", salt));

// Migrate a versioned document up before it reaches the schema decode.
const MigratedCodec = ConfigMigration.make({
 codec: JsonCodec,
 migrations: [
  { version: 1, name: "add-registry", up: (raw) => Effect.succeed({ ...(raw as object), registry: "https://registry.npmjs.org" }) },
  { version: 2, name: "rename-token", up: (raw) => Effect.succeed({ ...(raw as object), token: (raw as { authToken?: string }).authToken }) },
 ],
});
```

Subscribing to the load lifecycle with `ConfigEvents` — pass the class as `events`, provide its layer alongside the config layer, then subscribe to the `PubSub`:

```ts
import { ConfigEvents, ConfigFile, JsonCodec } from "@effected/config-file";
import { Effect, Layer, PubSub } from "effect";

const AppConfigLive = ConfigFile.layer(AppConfig, {
 schema: AppShape,
 codec: JsonCodec,
 resolvers: [ConfigResolver.upwardWalk({ filename: ".apprc" })],
 strategy: MergeStrategy.firstMatch(),
 events: ConfigEvents,
});
const AppLayer = Layer.mergeAll(ConfigEvents.layer, AppConfigLive);

const watch = Effect.gen(function* () {
 const events = yield* ConfigEvents;
 const subscription = yield* PubSub.subscribe(events.events);
 const cfg = yield* AppConfig;
 yield* Effect.fork(cfg.load);
 const event = yield* PubSub.take(subscription);
 return event.event._tag; // e.g. "Discovered", then "Parsed", then "Loaded"
}).pipe(Effect.scoped);
```

## Testing machinery

**`ConfigFile.testLayer(TagClass, { schema, codec, files })`** is exported and consumer-facing: it seeds the given files into a temp filesystem and runs the REAL implementation (not a mock). It has no `defaultPath`, so `save`/`update` honestly fail `ConfigDefaultPathMissingError` under it.

## Gotchas

- `ConfigFile.layer(...)` returns the layer from a function call — bind the result to a `const` before providing; two calls mint two independent service instances with separate state.
- `save` without a `defaultPath` is a typed runtime error (`ConfigDefaultPathMissingError`), not a compile error.
- `JsoncCodec.stringify` is byte-identical to `JsonCodec.stringify` — there is no comment-preserving write path.
- `ConfigEvents.layer` is a memoized-by-reference layer too — bind it to a `const` and provide that same reference wherever `events: ConfigEvents` is wired, or the subscriber ends up watching a different `PubSub` than the one `emit` publishes to.
- `EncryptedCodecKey.fromPassphrase`/`.fromCryptoKey` cache only the derivation's **success** per codec instance; a failed or interrupted derivation is retried on the next encrypt/decrypt call, not cached.
