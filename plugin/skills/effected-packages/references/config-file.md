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

- **Pipeline seams** — `ConfigCodec` (type-only interface, bytes ⇄ document, generic in its error so decorators widen rather than flatten); `ConfigResolver` with statics `explicitPath(target)` (the one bare-string signature), `staticDir({ dir, filename })`, `upwardWalk({ filename, cwd?, stopAt?, subpaths? })`, `workspaceRoot({ filename, ... })`, `gitRoot({ filename, ... })`, `systemEtc({ app, filename, dir? })` — each `resolve` has error channel `never`, absorbing fs failures into `Option.none()`; `MergeStrategy.firstMatch()` / `MergeStrategy.layeredMerge()`.
- **`ConfigFile.Service<Self, A>()(id)`** — a per-schema `Context.Service` class factory you extend for identity; `ConfigFile.layer(TagClass, { schema, codec, resolvers, strategy, validate?, events? })` wires it. Service surface: `load`, `loadFrom(path)`, `loadOrDefault(default)`, `discover`, `save`, `write(path)`, `update(fn)` (semaphore-serialized read-modify-write), `validate`.
- **The four codecs** — `JsonCodec` (zero-dep), `JsoncCodec` (comments do NOT survive a decode/encode round-trip), `YamlCodec`, `TomlCodec` (can genuinely fail to stringify — TOML has no null). Free-standing consts, one module each.
- **Decorators** — `EncryptedCodec(codec, key)` (AES-GCM) and `ConfigMigration.make(codec, steps, { versionAccess })` — both wrap any `ConfigCodec` and return one, widening the error channel.
- **`ConfigProvider` bridge** — `asConfigProvider(loadedDoc)` / `layerConfigProvider(...)` expose a loaded document to core `Config.*` reads.

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

## Testing machinery

**`ConfigFile.testLayer(TagClass, { schema, codec, files })`** is exported and consumer-facing: it seeds the given files into a temp filesystem and runs the REAL implementation (not a mock). It has no `defaultPath`, so `save`/`update` honestly fail `ConfigDefaultPathMissingError` under it.

## Gotchas

- `ConfigFile.layer(...)` returns the layer from a function call — bind the result to a `const` before providing; two calls mint two independent service instances with separate state.
- `save` without a `defaultPath` is a typed runtime error (`ConfigDefaultPathMissingError`), not a compile error.
- `JsoncCodec.stringify` is byte-identical to `JsonCodec.stringify` — there is no comment-preserving write path.
