# @effected/config-file-yaml

[![npm](https://img.shields.io/npm/v/@effected%2Fconfig-file-yaml?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/config-file-yaml)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

A YAML `ConfigCodec` for `@effected/config-file`, built on `@effected/yaml`. Plugs YAML 1.2 parsing and stringification into the codec seam so a config file can be YAML instead of JSON.

## Why @effected/config-file-yaml

`@effected/config-file` ships only the zero-dependency JSON codec in core, so pulling in a YAML parser is opt-in and lives in its own package. This adapter is thin on purpose: it does not reparse, reformat or duplicate anything `@effected/yaml` already does. It only translates `@effected/yaml`'s `YamlParseError` and `YamlStringifyError` into `@effected/config-file`'s `ConfigCodecError`, preserving the underlying error structurally in `cause` rather than flattening it into a string.

## Install

```bash
npm install @effected/config-file-yaml @effected/config-file @effected/yaml effect
```

```bash
pnpm add @effected/config-file-yaml @effected/config-file @effected/yaml effect
```

Requires Node.js >=24.11.0. `effect`, `@effected/config-file` and `@effected/yaml` are peer dependencies — this package adds no other runtime dependencies, and stays a peer rather than a regular dependency so the consumer's graph has exactly one `ConfigCodec` interface identity and one `@effected/yaml` instance.

## Quick start

```ts
import { YamlCodec } from "@effected/config-file-yaml";
import { ConfigFile, ConfigResolver, MergeStrategy } from "@effected/config-file";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, Layer, Schema } from "effect";

class AppShape extends Schema.Class<AppShape>("AppShape")({
  port: Schema.Number,
  host: Schema.String,
}) {}

class AppConfig extends ConfigFile.Service<AppConfig, AppShape>()("app/Config") {}

const AppConfigLive = ConfigFile.layer(AppConfig, {
  schema: AppShape,
  codec: YamlCodec,
  resolvers: [ConfigResolver.upwardWalk({ filename: ".apprc.yaml" })],
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

## Errors

`YamlCodec.parse` and `YamlCodec.stringify` both fail with `ConfigCodecError` (`codec: "yaml"`), the same error `@effected/config-file`'s own JSON codec raises. `error.cause` carries the originating failure structurally:

- On parse, `cause` is `@effected/yaml`'s `YamlParseError` — the aggregate of every recovered parse error, each with its `code`, `offset`, `length`, `line` and `character`.
- On stringify, `cause` is `@effected/yaml`'s `YamlStringifyError` — raised on a circular reference or on a value nested deeper than the stringifier's recursion budget.

Hostile input fails through this same typed channel rather than as a defect: `@effected/yaml` caps collection-nesting depth during parsing and bounds alias expansion with a materialized-node budget (the "billion laughs" denial-of-service guard), both reporting a fatal diagnostic inside `YamlParseError` rather than overflowing the stack or the heap. `YamlCodec` wraps either the same way it wraps any other parse failure.

## Features

- `YamlCodec` — a `ConfigCodec` (`name: "yaml"`) ready to pass to `ConfigFile.layer`, `MergeStrategy`, `EncryptedCodec` or `ConfigMigration.make`.

## License

[MIT](LICENSE)
