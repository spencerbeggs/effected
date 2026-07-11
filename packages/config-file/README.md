# @effected/config-file

[![npm](https://img.shields.io/npm/v/@effected%2Fconfig-file?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/config-file)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

Composable config file loading for Effect. Declare a resolver chain — an explicit path, an upward walk from the cwd, the workspace or git root, `/etc` — decode every discovered file through an Effect `Schema`, and combine the results with a merge strategy. JSON, JSONC, YAML and TOML all decode out of the box. Codecs, resolvers and merge strategies are pluggable seams, and failures arrive as tagged errors carrying structured payloads rather than prose, so "no config anywhere" is routable separately from "the config I found is broken".

## Why @effected/config-file

Config loading is where a well-typed application usually gives up: a library finds a file, parses it, validates it, and reports every one of those distinct failures as the same opaque error with a `reason` string. This package refuses that. Discovery, reading, parsing, validation and persistence each fail with their own tagged error, and each carries its cause structurally — a `ConfigValidationError` hands you the schema issue tree, not `String(ParseError)`. Resolver requirements flow into the layer's type rather than being cast away, the merge step reports every source that contributed rather than only the first, and a loaded document can be handed to `Config` accessors as a v4 `ConfigProvider` layered beneath the environment.

## Install

```bash
npm install @effected/config-file effect @effect/platform-node
```

```bash
pnpm add @effected/config-file effect @effect/platform-node
```

Requires Node.js >=24.11.0. Every format is covered by that one install; there is no separate package to add for YAML or TOML.

`effect` v4 is a peer dependency, and so are `@effected/jsonc`, `@effected/yaml` and `@effected/toml`, the first-party engines behind the JSONC, YAML and TOML codecs. Package managers that install peers automatically will pull them in; add them to your manifest explicitly if yours does not. Nothing outside `effect` and `@effected/*` reaches your tree.

Reading and writing files needs a `FileSystem` and a `Path` implementation, provided once at the edge — from `@effect/platform-node` on Node.

## Quick start

Declare a schema, mint a service class for it with `ConfigFile.Service`, and build its live layer with `ConfigFile.layer`. The platform layers are provided once, at the edge:

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

`ConfigFile.layer` is a layer-returning *function*, not a layer: calling it twice builds two independent service instances. Bind its result to a const, as above, and provide that const.

Resolvers are consulted in priority order, highest first. `MergeStrategy.firstMatch` takes the winner; `MergeStrategy.layeredMerge` deep-merges every source that matched, with higher-priority keys overwriting lower ones:

```ts
import { ConfigFile, ConfigResolver, MergeStrategy, YamlCodec } from "@effected/config-file";
import { Schema } from "effect";

class Settings extends Schema.Class<Settings>("Settings")({ port: Schema.Number }) {}
class SettingsConfig extends ConfigFile.Service<SettingsConfig, Settings>()("app/Settings") {}

export const SettingsLive = ConfigFile.layer(SettingsConfig, {
  schema: Settings,
  codec: YamlCodec,
  resolvers: [
    ConfigResolver.upwardWalk({ filename: ".apprc.yaml" }),
    ConfigResolver.workspaceRoot({ filename: ".apprc.yaml" }),
    ConfigResolver.systemEtc({ app: "myapp", filename: "config.yaml" }),
  ],
  strategy: MergeStrategy.layeredMerge<Settings>(),
});
```

## Errors

Every failure is a tagged error you route on with `Effect.catchTag`. The tags exist so that recovery can differ:

| Tag | Means | Recovery |
| --- | --- | --- |
| `ConfigFileNotFoundError` | The resolver chain matched nothing. Carries `searched`, the resolver names probed. | Fall back to defaults — the one failure that is often not an error. `loadOrDefault` handles it for you. |
| `ConfigFileReadError` | A file was found but could not be read. Carries `path` and the structural `cause`. | Usually fatal: the file exists and the process cannot read it. Check permissions. |
| `ConfigFileWriteError` | A file could not be written. Carries `path` and the structural `cause`. | Retry elsewhere, or surface to the user. |
| `ConfigDefaultPathMissingError` | `save` or `update` was called on a service configured without a `defaultPath`. | A wiring bug, not a data condition. Fix the layer, or call `write` with an explicit path. |
| `ConfigValidationError` | The document did not satisfy the schema, or a caller-supplied `validate` rejected it. Carries the structured `issue` tree and an optional `path`. | Report the issue; do not run on config you could not validate. |
| `ConfigCodecError` | The codec could not parse or stringify. Carries `codec`, `operation` and the structural `cause`. | The file is corrupt. Report the path and the cause. |
| `ConfigMigrationError` | A versioned migration failed. Carries `version`, `name`, `phase` and the structural `cause`. | Report which step failed; the config on disk is left untouched. |
| `ConfigEncryptionError` | An encrypt, decrypt, key-derivation or base64 step failed. Carries `phase` and the structural `cause`. | A wrong passphrase and a corrupt envelope both land here; inspect `phase`. |

`ConfigLoadError`, `ConfigReadError`, `ConfigWriteError`, `ConfigSaveError` and `ConfigUpdateError` are exported unions naming exactly the failures each method can produce. Catching one tag narrows the union, leaving the rest to propagate:

```ts
import type { ConfigFileShape } from "@effected/config-file";
import { Effect, Schema } from "effect";

class AppShape extends Schema.Class<AppShape>("AppShape")({ port: Schema.Number }) {}

const fallback = new AppShape({ port: 3000 });

// `load` fails with ConfigLoadError. Handling the not-found tag leaves
// ConfigReadError — the file-is-broken failures, which we let propagate.
export const loadOrFallback = (config: ConfigFileShape<AppShape>) =>
  config.load.pipe(Effect.catchTag("ConfigFileNotFoundError", () => Effect.succeed(fallback)));
```

## Codecs

Four codecs ship in the package, each a free-standing named export:

| Codec | Format | Engine |
| ----- | ------ | ------ |
| `JsonCodec` | JSON | the host `JSON` global, no parser at all |
| `JsoncCodec` | JSONC | `@effected/jsonc` |
| `YamlCodec` | YAML | `@effected/yaml` |
| `TomlCodec` | TOML | `@effected/toml` |

One install covers every format, and you still pay only for the parser you name. The codecs are free-standing exports rather than properties of a namespace object, so importing `TomlCodec` never references the YAML or JSONC bindings, their parsing engines are unreachable from your entrypoint and a bundler drops them. A JSON-only application ships no parser at all.

Codecs compose. `EncryptedCodec` wraps any codec with AES-GCM, and `ConfigMigration.make` wraps any codec so parsed content is brought up to the latest version. Each *widens* the error channel rather than flattening its failures into the inner codec's error:

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

## Features

- `ConfigFile.Service` / `ConfigFile.layer` / `ConfigFile.testLayer` — a per-schema service class and its layers. `testLayer` seeds files into a temp directory and wires the *real* implementation over them, so tests exercise the actual pipeline rather than a stub that can drift from it.
- `ConfigResolver` — `explicitPath`, `staticDir`, `upwardWalk`, `workspaceRoot`, `gitRoot` and `systemEtc`. A resolver's error channel is `never` by contract: every filesystem failure becomes `Option.none()`, so one unreadable tier never aborts the chain.
- `MergeStrategy` — `firstMatch` and `layeredMerge`, combining discovered sources in priority order.
- `JsonCodec`, `JsoncCodec`, `YamlCodec`, `TomlCodec` — JSON, JSONC, YAML and TOML in the box, exported free-standing so an unused format's engine is tree-shaken away.
- `ConfigCodec` / `EncryptedCodec` / `ConfigMigration` — a pluggable codec seam, generic in its error type so decorators widen rather than flatten. `ConfigCodec` is the interface: bring your own format by satisfying it.
- `ConfigEvents` — an opt-in `PubSub` of `ConfigEvent`, honestly zero-cost when omitted: no `events` option means no context lookup at all. Failure events carry the structured typed error, never a `reason` string.
- `asConfigProvider` / `layerConfigProvider` — expose a loaded, validated document as a v4 `ConfigProvider`, layered beneath the ambient one so an environment variable overrides the file it was deployed with.

## License

[MIT](LICENSE)
