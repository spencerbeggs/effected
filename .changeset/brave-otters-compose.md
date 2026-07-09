---
"@effected/config-file": minor
---

## Features

Initial release of `@effected/config-file` — composable config file loading for Effect v4. Declare a resolver chain (an explicit path, an upward walk from the cwd, the workspace or git root, `/etc`), decode every discovered file through an Effect `Schema`, and combine the results with a merge strategy. Codecs, resolvers and merge strategies are all pluggable seams, and every failure arrives as a tagged error carrying a structured payload rather than prose — so "no config anywhere" is routable separately from "the config I found is broken":

```ts
import { ConfigCodec, ConfigFile, ConfigResolver, MergeStrategy } from "@effected/config-file";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, Layer, Schema } from "effect";

class AppShape extends Schema.Class<AppShape>("AppShape")({
  port: Schema.Number,
  host: Schema.String,
}) {}

class AppConfig extends ConfigFile.Service<AppConfig, AppShape>()("app/Config") {}

const AppConfigLive = ConfigFile.layer(AppConfig, {
  schema: AppShape,
  codec: ConfigCodec.json,
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

Reading and writing needs a `FileSystem` and a `Path`, provided once at the edge — the package itself adds no runtime dependencies beyond the `effect` peer.

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

### Codecs compose

Only the zero-dependency `ConfigCodec.json` ships in core; format-specific codecs live in sibling packages (`@effected/config-file-jsonc`, `@effected/config-file-yaml` today; `@effected/config-file-toml` waits on `@effected/toml`). `EncryptedCodec` wraps any codec with AES-GCM, and `ConfigMigration.make` wraps any codec so parsed content is brought up to the latest version — each *widens* the error channel rather than flattening its failures into the inner codec's:

```ts
import { ConfigCodec, ConfigMigration, EncryptedCodec, EncryptedCodecKey } from "@effected/config-file";
import { Effect } from "effect";

const migrating = ConfigMigration.make({
  codec: ConfigCodec.json,
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

### Not yet ported

The file watcher (`@effected/config-file-watcher`) and the TOML codec (`@effected/config-file-toml`, waiting on `@effected/toml`) are their own migration cycles and are not part of this release.
