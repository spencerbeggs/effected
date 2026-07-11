---
"@effected/config-file": minor
---

## Features

Initial release of `@effected/config-file` — composable config file loading for Effect v4. Declare a resolver chain (an explicit path, an upward walk from the cwd, the workspace or git root, `/etc`), decode every discovered file through an Effect `Schema`, and combine the results with a merge strategy. Codecs, resolvers and merge strategies are all pluggable seams, and every failure arrives as a tagged error carrying a structured payload rather than prose — so "no config anywhere" is routable separately from "the config I found is broken":

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

Reading and writing needs a `FileSystem` and a `Path`, provided once at the edge — the package itself has no *external* runtime dependencies. The four codecs are backed by `@effected/jsonc`, `@effected/yaml` and `@effected/toml`, taken as workspace peers; those format engines are first-party and themselves dependency-free.

### A tagged error per failure mode, not one stringly-typed `ConfigError`

Coming from `config-file-effect` (the Effect v3 predecessor this package redesigns rather than ports): every pipeline failure — a missing file, a read error, a codec parse failure, a schema rejection, a custom `validate` rejection — used to collapse into one `ConfigError` carrying a `reason: string`, so `catchTag("ConfigError")` could never distinguish "no config found" from "the config I found is corrupt", and structured causes were lost to `String(cause)`. That error is gone. Eight tagged errors replace it, each carrying its cause as data:

| Tag | Means |
| --- | --- |
| `ConfigFileNotFoundError` | The resolver chain matched nothing. Carries `searched`, the resolver names probed. |
| `ConfigFileReadError` | A file was found but could not be read. Carries `path` and the structural `cause`. |
| `ConfigFileWriteError` | A file could not be written. Carries `path` and the structural `cause`. |
| `ConfigDefaultPathMissingError` | `save` or `update` was called on a service configured without a `defaultPath`. |
| `ConfigValidationError` | The document did not satisfy the schema, or a caller-supplied `validate` rejected it. Carries the structured `issue` tree. |
| `ConfigCodecError` | The codec could not parse or stringify. Carries `codec`, `operation` and the structural `cause`. |
| `ConfigMigrationError` | A versioned migration failed. Carries `version`, `name`, `phase` and the structural `cause`. |
| `ConfigEncryptionError` | An encrypt, decrypt, key-derivation or base64 step failed. Carries `phase` and the structural `cause`. |

Each service method exposes a narrowed union naming exactly the tags it can produce — `loadOrDefault` cannot fail with `ConfigFileNotFoundError`, `write` cannot either, and `validate` fails only with `ConfigValidationError` — so `Effect.catchTag` recovers the one case that matters and lets the rest propagate typed.

### Service identity is a class you extend

A config's identity is `class AppConfig extends ConfigFile.Service<AppConfig, AppShape>()("app/Config") {}`, wired to a live implementation with `ConfigFile.layer(AppConfig, { schema, codec, resolvers, strategy })`. `ConfigFile.layer` is a layer-returning *function*, not a layer — calling it twice builds two independent service instances, so bind its result to a const and provide that.

### Resolvers and merge strategies

* `ConfigResolver.explicitPath` / `staticDir` / `upwardWalk` / `workspaceRoot` / `gitRoot` / `systemEtc` — a resolver's error channel is `never` by contract, so one unreadable tier never aborts the chain.
* `MergeStrategy.firstMatch` takes the highest-priority match; `MergeStrategy.layeredMerge` deep-merges every source that matched, with higher-priority keys winning. (The v3 predecessor called this seam `ConfigWalkStrategy`, despite it never walking anything — the `upwardWalk` resolver does that — and named a source's priority tier `ConfigSource.tier`; here it's `MergeStrategy` and `ConfigSource.resolver`.)

### Four codecs, shipped as free-standing exports

JSON, JSONC, YAML and TOML all ship in core, one named export each — `JsonCodec`, `JsoncCodec`, `YamlCodec`, `TomlCodec`. Each is a `ConfigCodec` ready to pass to `ConfigFile.layer`, `MergeStrategy`, `EncryptedCodec` or `ConfigMigration.make`, and every one of them fails with `ConfigCodecError`, wrapping the underlying format error structurally in `cause` rather than flattening it to a string:

```ts
import { ConfigFile, ConfigResolver, MergeStrategy, TomlCodec } from "@effected/config-file";

const AppConfigLive = ConfigFile.layer(AppConfig, {
  schema: AppShape,
  codec: TomlCodec,
  resolvers: [ConfigResolver.upwardWalk({ filename: ".apprc.toml" })],
  strategy: MergeStrategy.firstMatch<AppShape>(),
});
```

`ConfigCodec` is the **interface only** — the codecs are deliberately *not* collected into a namespace object. A namespace object is a barrel with different syntax: touching it reaches every codec, each codec reaches its parsing engine, and a JSON-only consumer drags the JSONC, YAML and TOML engines into their bundle. Import the one codec you name and a bundler drops the rest.

* `JsonCodec` (`name: "json"`) — strict JSON, zero parsing engine behind it.
* `JsoncCodec` (`name: "jsonc"`) — comment- and trailing-comma-tolerant parsing, the format behind `tsconfig.json` and VS Code settings. **Its `stringify` writes plain JSON, not JSONC** — `@effected/jsonc` exposes no comment-preserving encode, so comments do not survive a load-mutate-save round trip.
* `YamlCodec` (`name: "yaml"`) — YAML 1.2, and unlike the JSONC codec it has a genuine encode path: `stringify` round-trips through `@effected/yaml`'s own serializer, with no comment-loss caveat.
* `TomlCodec` (`name: "toml"`) — TOML 1.0.0. `@effected/toml`'s hardening rides along: array and inline-table nesting past the engine's depth cap fails as a typed `ConfigCodecError` carrying a positioned `NestingDepthExceeded` diagnostic, never a stack-overflow defect — on both the parse and stringify sides. TOML's value model surfaces honestly at the seam: date-times decode to `@effected/toml`'s four date-time classes, integers beyond ±(2^53 − 1) decode to `bigint`, and a document carrying `null` (which TOML cannot represent) fails `stringify` with a structured `UnsupportedValue` diagnostic in `cause`.

### Codecs compose

`EncryptedCodec` wraps any codec with AES-GCM, and `ConfigMigration.make` wraps any codec so parsed content is brought up to the latest version — each *widens* the error channel rather than flattening its failures into the inner codec's:

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

// `parse` now fails with ConfigCodecError | ConfigMigrationError | ConfigEncryptionError.
export const secret = EncryptedCodec(migrating, EncryptedCodecKey.fromPassphrase("hunter2", new Uint8Array(16)));
```

### ConfigProvider integration

`asConfigProvider` / `layerConfigProvider` expose a loaded, merged, schema-validated document as a v4 `ConfigProvider`, so it can be read through `Config.string("port")` and layered beneath the environment — an environment variable can override the value the file shipped with.

### Also new

`ConfigEvents` — an opt-in `PubSub` of `ConfigEvent`, honestly zero-cost when omitted: no `events` option means no context lookup at all. Failure events carry the structured typed error, never a `reason` string.

### Security

`EncryptedCodec`'s PBKDF2 key derivation runs at 600,000 iterations rather than the 100,000 its v3 predecessor used, following current OWASP guidance for PBKDF2-HMAC-SHA256. Derivation is memoized per codec instance, so the cost is paid once. This is the one deliberate divergence from an otherwise verbatim port of v3's AES-GCM implementation.

### Not yet ported

The file watcher (`@effected/config-file-watcher`) is its own migration cycle and is not part of this release.
