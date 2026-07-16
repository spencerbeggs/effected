# @effected/tsconfig-json

tsconfig.json schemas, tsc-parity `extends`-chain resolution, and nearest-config discovery. Boundary tier: all IO through core `FileSystem`/`Path`, zero external runtime deps (peers on `@effected/jsonc` and `@effected/walker`). Hard rule inside: zero `typescript` imports — version-coupled knowledge lives as data.

## Import

```ts
import { PortableTsconfig, TsconfigDiscovery, TsconfigJson, TsconfigLoader, TsEnumCodec } from "@effected/tsconfig-json";
```

Single entrypoint; no subpaths.

**Platform**: every effectful static requires `FileSystem`/`Path` in `R` — provide `@effect/platform-node` or `@effect/platform-bun` once at the edge (wired in the examples below). `TsEnumCodec` and the schemas are pure.

## Core API

- **`TsconfigJson`** — the document schema (`compilerOptions`, `extends`, `files`, `include`, `exclude`, `references`, …); `TsconfigJsonFromString` decodes from JSONC (every tsconfig parses as JSONC — there is no JSON-strict path); `TsconfigParseError` on failure.
- **`CompilerOptions`** + enum sub-schemas (`Target`, `Module`, `ModuleResolution`, `Jsx`, `Lib`, …) — case-insensitive decode, canonical-lowercase encode, unknown/dead options pass through.
- **`TsconfigLoader`** — `load(configPath)` reads + decodes one file; `resolve(configPath)` does full `extends`-chain resolution with tsc semantics (relative/rooted/bare specifiers, `package.json` `"tsconfig"` field, `exports`-map subset, depth guard 32, cycle detection) returning `ResolvedTsconfig` (`configPath`, `extendedPaths`, merged `compilerOptions`). Fails `TsconfigParseError | TsconfigExtendsError`.
- **`TsconfigDiscovery.findNearest(start, { filename?, stopAt? })`** — upward search; returns `Option<string>`, never an error.
- **`TsEnumCodec`** — pure string↔numeric compiler-enum tables plus `encodeCompilerOptions`/`decodeCompilerOptions`, for feeding a virtual-TS/Twoslash environment.
- **`PortableTsconfig`** — allow-list filter producing a self-contained config (`composite: false`, `noEmit: true` forced).

## Usage

```ts
import { TsconfigLoader } from "@effected/tsconfig-json";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, Layer } from "effect";

const options = TsconfigLoader.resolve("./tsconfig.json").pipe(
 Effect.map((resolved) => resolved.compilerOptions),
 Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
);
```

## Testing machinery

None exported. The package has no services of its own — everything is an effectful static requiring `FileSystem`/`Path` in `R`, so tests substitute an in-memory `FileSystem` layer directly.

## Gotchas

- Deliberate tsc divergence: target probing uses `fs.exists` (true for directories), so a relative `extends` naming a real directory resolves it verbatim and the read fails typed — tsc would retry `dir.json`.
- `decodeCompilerOptions` returns `Record<string, unknown>`, not validated `CompilerOptions.Type` — decode through the schema afterward for the typed shape.
- `exports`-map wildcard matching is longest-prefix (not first-in-order), and a malformed `package.json` coerces to `{}` and falls through to the `<pkg>/tsconfig.json` probe — both tsc-parity behaviors.
