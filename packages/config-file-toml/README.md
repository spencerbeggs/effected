# @effected/config-file-toml

[![npm](https://img.shields.io/npm/v/@effected%2Fconfig-file-toml?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/config-file-toml)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

A TOML `ConfigCodec` for `@effected/config-file`, built on `@effected/toml`. Plugs TOML 1.0.0 parsing and stringification into the codec seam so a config file can be TOML instead of JSON.

## Why @effected/config-file-toml

`@effected/config-file` ships only the zero-dependency JSON codec in core, so pulling in a TOML parser is opt-in and lives in its own package. This adapter is thin on purpose: it does not reparse, reformat or duplicate anything `@effected/toml` already does. It only translates `@effected/toml`'s `TomlParseError` and `TomlStringifyError` into `@effected/config-file`'s `ConfigCodecError`, preserving the underlying error structurally in `cause` rather than flattening it into a string.

## Install

```bash
npm install @effected/config-file-toml @effected/config-file @effected/toml effect
```

```bash
pnpm add @effected/config-file-toml @effected/config-file @effected/toml effect
```

Requires Node.js >=24.11.0. `effect`, `@effected/config-file` and `@effected/toml` are peer dependencies — this package adds no other runtime dependencies, and stays a peer rather than a regular dependency so the consumer's graph has exactly one `ConfigCodec` interface identity and one `@effected/toml` instance.

## Quick start

```ts
import { TomlCodec } from "@effected/config-file-toml";
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
  codec: TomlCodec,
  resolvers: [ConfigResolver.upwardWalk({ filename: ".apprc.toml" })],
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

`TomlCodec.parse` and `TomlCodec.stringify` both fail with `ConfigCodecError` (`codec: "toml"`), the same error `@effected/config-file`'s own JSON codec raises. `error.cause` carries the originating failure structurally:

- On parse, `cause` is `@effected/toml`'s `TomlParseError` — its `diagnostics` array positions the first violation with a `code`, `offset`, `length`, `line` and `character`.
- On stringify, `cause` is `@effected/toml`'s `TomlStringifyError` — raised on an unrepresentable value (TOML has no null), an out-of-int64-range `bigint`, a circular reference or a value nested deeper than the stringifier's depth cap.

Hostile input fails through this same typed channel rather than as a defect: `@effected/toml` caps array and inline-table nesting depth independently on both the parse and stringify sides, reporting a `NestingDepthExceeded` diagnostic rather than overflowing the stack. `TomlCodec` wraps either the same way it wraps any other failure.

Note the value model on parse: TOML date-times decode to `@effected/toml`'s four date-time classes (`TomlLocalDate`, `TomlLocalTime`, `TomlLocalDateTime`, `TomlOffsetDateTime`), and integers beyond ±(2^53 − 1) decode to `bigint`. Your config schema decides what to accept.

## Features

- `TomlCodec` — a `ConfigCodec` (`name: "toml"`) ready to pass to `ConfigFile.layer`, `MergeStrategy`, `EncryptedCodec` or `ConfigMigration.make`.

## License

[MIT](LICENSE)
