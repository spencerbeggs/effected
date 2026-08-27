# @effected/tsconfig-json

tsconfig.json schemas, tsc-parity `extends`-chain resolution, and nearest-config discovery. Boundary tier: all IO through core `FileSystem`/`Path`, zero external runtime deps (peers on `@effected/jsonc` and `@effected/walker`). Hard rule inside: zero `typescript` imports — version-coupled knowledge lives as data.

## Import

```ts
import { PortableTsconfig, TsconfigDiscovery, TsconfigJson, TsconfigLoader, TsconfigLoaderSync, TsEnumCodec } from "@effected/tsconfig-json";
```

Single entrypoint; no subpaths.

**Platform**: every effectful static requires `FileSystem`/`Path` in `R` — provide `@effect/platform-node` or `@effect/platform-bun` once at the edge (wired in the examples below). `TsconfigLoaderSync`, `TsEnumCodec` and the schemas are pure/sync — no `R`.

## Core API

- **`TsconfigJson`** — the document schema (`compilerOptions`, `extends`, `files`, `include`, `exclude`, `references`, `watchOptions`, `typeAcquisition`, `compileOnSave`, `$schema`, …); `TsconfigJsonFromString` decodes from JSONC (every tsconfig parses as JSONC — there is no JSON-strict path); `TsconfigParseError` on failure.
- **`CompilerOptions`** + enum sub-schemas (`Target`, `Module`, `ModuleResolution`, `Jsx`, `Lib`, `NewLine`, `ModuleDetection`, `WatchFile`, `WatchDirectory`, `FallbackPolling`, …) — case-insensitive decode, canonical-lowercase encode, unknown/dead options pass through.
- **`TsconfigLoader`** — `load(configPath)` reads + decodes one file (`Effect<TsconfigJson.Type, PlatformError | TsconfigParseError, FileSystem | Path>`); `resolve(configPath)` does full `extends`-chain resolution with tsc semantics (relative/rooted/bare specifiers, `package.json` `"tsconfig"` field, `exports`-map subset, depth guard 32, cycle detection) returning a `ResolvedTsconfig` (`configPath`, `extendedPaths`, merged `compilerOptions`, plus `files`/`include`/`exclude`/`references`/`watchOptions`/`typeAcquisition`/`compileOnSave`/`pathsBase` when present); `compilerOptions(configPath)` projects straight to the merged options. All three fail `PlatformError | TsconfigParseError`, and `resolve`/`compilerOptions` additionally `TsconfigExtendsError` (`reason: "not-found" | "cycle" | "depth" | "empty"`, carrying the full resolution `chain`).
- **`TsconfigLoaderSync`** — the same `load`/`resolve`/`compilerOptions` trio run synchronously (`Effect.runSyncExit` under the hood) against consumer-supplied `SyncFileSystem`/`SyncPath` — structural subsets of `node:fs`'s `existsSync`/`readFileSync` and `node:path`, so the real modules satisfy them verbatim. For sync-only host APIs (bundler plugin hooks, config factories) that cannot `await`; everything else should use `TsconfigLoader` with a real platform layer.
- **`TsconfigDiscovery.findNearest(start, { filename?, stopAt? })`** — upward search; returns `Option<string>`, never an error.
- **`TsEnumCodec`** — pure string↔numeric compiler-enum tables (`encode`/`decode` per `EnumFamily`, each returning `Option`, never throwing) plus `encodeCompilerOptions`/`decodeCompilerOptions` and `normalizeLibReference`, for feeding a virtual-TS/Twoslash environment.
- **`PortableTsconfig`** — `PortableTsconfig.make(resolvedOrCompilerOptions)` allow-list filter producing a self-contained, JSON-serializable config (`$schema` stamped, `compilerOptions`-only — no absolute or machine-specific paths, no emit/file-selection surface).

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

Nearest-config discovery before loading — `findNearest` never fails, so a "no tsconfig above here" caller checks the `Option` rather than catching an error:

```ts
import { TsconfigDiscovery, TsconfigLoader } from "@effected/tsconfig-json";
import { Effect, Option } from "effect";

const program = Effect.gen(function* () {
 const found = yield* TsconfigDiscovery.findNearest(process.cwd());
 if (Option.isNone(found)) return Option.none();
 return Option.some(yield* TsconfigLoader.resolve(found.value));
});
```

A sync-only host (a bundler plugin hook) resolving a tsconfig without `await`:

```ts
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { TsconfigLoaderSync } from "@effected/tsconfig-json";

const resolved = TsconfigLoaderSync.resolve("./tsconfig.json", {
 fileSystem: { exists: existsSync, readFile: (p) => readFileSync(p, "utf8") },
 path, // node:path structurally satisfies SyncPath
});
```

Feeding a virtual TypeScript environment (Twoslash-style) with numeric enum values, then narrowing the decoded result back to typed `CompilerOptions`:

```ts
import { CompilerOptions, TsEnumCodec } from "@effected/tsconfig-json";
import { Schema } from "effect";

const numeric = TsEnumCodec.encodeCompilerOptions(resolved.compilerOptions); // { target: 9, module: 199, ... }
const roundTripped = TsEnumCodec.decodeCompilerOptions(numeric); // Record<string, unknown> — not yet validated
const typed = Schema.decodeUnknownSync(CompilerOptions)(roundTripped);
```

Producing a portable, machine-independent config for a virtual environment:

```ts
import { PortableTsconfig } from "@effected/tsconfig-json";

const portable = PortableTsconfig.make(resolved); // { $schema, compilerOptions } — no outDir/rootDir/paths absolutes
```

## Testing machinery

None exported. The package has no services of its own — everything is an effectful static requiring `FileSystem`/`Path` in `R` (or, for `TsconfigLoaderSync`, a plain object satisfying `SyncFileSystem`/`SyncPath`), so tests substitute an in-memory `FileSystem` layer, or a hand-rolled sync stub, directly.

## Gotchas

- Deliberate tsc divergence: target probing uses `fs.exists` (true for directories), so a relative `extends` naming a real directory resolves it verbatim and the read fails typed — tsc would retry `dir.json`.
- `decodeCompilerOptions` returns `Record<string, unknown>`, not validated `CompilerOptions.Type` — decode through the schema afterward for the typed shape.
- `exports`-map wildcard matching is longest-prefix (not first-in-order), and a malformed `package.json` coerces to `{}` and falls through to the `<pkg>/tsconfig.json` probe — both tsc-parity behaviors.
- `TsconfigLoader.resolve`/`.compilerOptions` fail with `PlatformError | TsconfigExtendsError | TsconfigParseError` — the raw filesystem failure is not folded into the parse error.
- `TsconfigLoaderSync`'s two adapters are asymmetric on unsupported calls: an unused `SyncPath` member throws a named defect on contact, while an unused `FileSystem` member beyond `exists`/`readFileString` degrades to `FileSystem.makeNoop`'s typed `NotFound` — a loader change that starts calling a new fs operation surfaces as `NotFound`, not a defect.
