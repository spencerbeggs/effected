# @effected/config-file-jsonc

[![npm](https://img.shields.io/npm/v/@effected%2Fconfig-file-jsonc?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/config-file-jsonc)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

A JSONC `ConfigCodec` for `@effected/config-file`, built on `@effected/jsonc`. Plugs comment- and trailing-comma-tolerant parsing into the codec seam so a config file can be JSONC — the format behind `tsconfig.json` and VS Code settings — instead of strict JSON.

## Why @effected/config-file-jsonc

`@effected/config-file` ships only the zero-dependency JSON codec in core, so pulling in a JSONC parser is opt-in and lives in its own package. This adapter is thin on purpose: it does not reparse, reformat or duplicate anything `@effected/jsonc` already does. It only translates `@effected/jsonc`'s `JsoncParseError` into `@effected/config-file`'s `ConfigCodecError`, preserving the underlying error structurally in `cause` rather than flattening it into a string.

## Install

```bash
npm install @effected/config-file-jsonc @effected/config-file @effected/jsonc effect
```

```bash
pnpm add @effected/config-file-jsonc @effected/config-file @effected/jsonc effect
```

Requires Node.js >=24.11.0. `effect`, `@effected/config-file` and `@effected/jsonc` are peer dependencies — this package adds no other runtime dependencies, and stays a peer rather than a regular dependency so the consumer's graph has exactly one `ConfigCodec` interface identity and one `@effected/jsonc` instance.

## Quick start

```ts
import { JsoncCodec } from "@effected/config-file-jsonc";
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
  codec: JsoncCodec,
  resolvers: [ConfigResolver.upwardWalk({ filename: ".apprc.jsonc" })],
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

`JsoncCodec.parse` and `JsoncCodec.stringify` both fail with `ConfigCodecError` (`codec: "jsonc"`), the same error `@effected/config-file`'s own JSON codec raises. `error.cause` carries the originating failure structurally:

- On parse, `cause` is `@effected/jsonc`'s `JsoncParseError` — the aggregate of every recovered parse error, each with its `code`, `offset`, `length`, `line` and `character`.
- On stringify, `@effected/jsonc` has no `stringify` of its own — its schema layer's encode direction is `JSON.stringify`, and comments never survive a round-trip encode. `JsoncCodec.stringify` follows the same convention: it calls `JSON.stringify` and wraps a thrown defect (a circular value, for instance) the same way the core JSON codec does.

Hostile input — pathologically deep nesting — fails through this same typed channel rather than as a defect: `@effected/jsonc`'s recursive-descent parser caps nesting depth and reports it as a parse error, which `JsoncCodec` wraps like any other.

## Features

- `JsoncCodec` — a `ConfigCodec` (`name: "jsonc"`) ready to pass to `ConfigFile.layer`, `MergeStrategy`, `EncryptedCodec` or `ConfigMigration.make`.

## License

[MIT](LICENSE)
