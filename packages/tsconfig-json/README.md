# @effected/tsconfig-json

[![npm](https://img.shields.io/npm/v/@effected%2Ftsconfig-json?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/tsconfig-json)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

Composable tsconfig.json handling for Effect: document and compiler-option schemas, `extends`-chain resolution with tsc's own merge semantics, nearest-config discovery and a portable-config filter for virtual TypeScript environments. Every parse is JSONC — comments and trailing commas are legal everywhere, exactly as tsc treats them — and options the schemas do not know pass through decode and encode untouched instead of being dropped.

> **Pre-release.** This package is part of the `@effected/*` kit, in pre-`1.0.0`
> development against a single pinned Effect v4 beta. Packages graduate to
> `1.0.0` once Effect `4.0.0` ships. To hold your own `effect` versions at
> exactly the ones the kit is built and tested against, install
> [`@effected/pnpm-plugin-effect`](https://www.npmjs.com/package/@effected/pnpm-plugin-effect).
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version — even a
> package marked *stable* before `1.0.0` can introduce a breaking change by
> accident, and an exact pin turns that into a type-check error rather than a
> runtime surprise. Full policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Why @effected/tsconfig-json

Reading a tsconfig.json correctly means reproducing what tsc does, and what tsc does is more than `JSON.parse` plus `Object.assign`. An `extends` target resolves like a module: a bare specifier walks ancestor `node_modules` directories, a package's `exports` map can redirect or block it, and a `tsconfig` field in its manifest can point somewhere else entirely. Merging the chain is per-field, path options absolutize against the config that declared them rather than the one you loaded, and `${configDir}` substitutes once at the end against the top config's directory. These rules were extracted from the TypeScript compiler's source and encoded here as data-driven tests, so the resolution you get is the resolution tsc computes.

The package does all of this without importing `typescript`, not even as a type. It works at the string level — `"target": "es2023"` stays a string through schema, merge and discovery — and the version-coupled numeric enum mappings live in `TsEnumCodec` as plain data tables, so converting to the numeric shape a real compiler expects is an explicit final step rather than a dependency you carry everywhere. Malformed input always fails through a typed error channel, and the recursive `extends` walk carries cycle and depth guards, because a config file is untrusted input.

## Install

```bash
npm install @effected/tsconfig-json @effected/jsonc @effected/walker effect
```

```bash
pnpm add @effected/tsconfig-json @effected/jsonc @effected/walker effect
```

Requires Node.js >=24.11.0. `effect` v4, `@effected/jsonc` and `@effected/walker` are peer dependencies; there are no runtime dependencies of its own.

All IO goes through `FileSystem` and `Path` from `effect` core, not a platform package, so a consumer provides them once at the edge (`@effect/platform-node` on Node, `@effect/platform-bun` on Bun) and a test provides `Path.layer` and `FileSystem.layerNoop` straight from core with nothing else installed.

## Quick start

Resolve a config and its full `extends` chain:

```ts
import { TsconfigLoader } from "@effected/tsconfig-json";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, Layer } from "effect";

const PlatformLive = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

const resolved = await Effect.runPromise(TsconfigLoader.resolve("./tsconfig.json").pipe(Effect.provide(PlatformLive)));

console.log(resolved.extendedPaths);
// every config on the extends chain as normalized absolute paths, base-most first and your own config last
console.log(resolved.compilerOptions);
// the merged options after folding the whole chain — later configs win per field, paths replaced wholesale
```

`TsconfigLoader.compilerOptions("./tsconfig.json")` is the same pipeline projected down to the merged options, for when the effective options are all you want.

Find the nearest config first when you only have a starting directory:

```ts
import { TsconfigDiscovery } from "@effected/tsconfig-json";
import { Effect, Option } from "effect";

const nearest = TsconfigDiscovery.findNearest(process.cwd());
// Effect<Option<string>, never, FileSystem | Path> — absence is Option.none(), never an error
```

Hand the result to a real compiler by encoding the enum families to their numeric form, or narrow it to the portable subset a virtual TypeScript environment can safely reuse:

```ts
import { PortableTsconfig, TsEnumCodec } from "@effected/tsconfig-json";

console.log(TsEnumCodec.encodeCompilerOptions({ target: "es2023", strict: true, lib: ["esnext"] }));
// { target: 10, strict: true, lib: [ 'lib.esnext.d.ts' ] }

console.log(PortableTsconfig.make(resolved).compilerOptions.noEmit);
// true — always forced, whatever the source config declared
```

## Synchronous loading

Bundler plugin hooks and config factories often cannot await. `TsconfigLoaderSync` runs the unchanged loader pipeline synchronously over file and path operations you supply — the package still imports no `node:*` module, and Node's built-ins satisfy the operations directly:

```ts
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { TsconfigLoaderSync } from "@effected/tsconfig-json";

const options = {
  fileSystem: { exists: existsSync, readFile: (p: string) => readFileSync(p, "utf8") },
  path, // node:path satisfies SyncPath verbatim; path.win32 / path.posix force a convention
};

const compilerOptions = TsconfigLoaderSync.compilerOptions("./tsconfig.json", options);
// the merged options for the full extends chain — the same result TsconfigLoader.resolve computes
```

`load` and `resolve` have the same synchronous forms. Failures are the async pipeline's own typed errors thrown as themselves — `TsconfigParseError`, `TsconfigExtendsError` or a `PlatformError` wrapping whatever your `readFile` threw — never a fiber-failure wrapper.

## Features

- `TsconfigJson` / `TsconfigJsonFromString` — the document schema and its JSONC string codec. Comments and trailing commas are legal in every parse; there is no JSON-strict path.
- `CompilerOptions` — string-level schemas for `compilerOptions`: enum values decode case-insensitively and encode to canonical lowercase, and unknown or removed options survive a round trip as passthrough.
- `TsconfigLoader.load` / `TsconfigLoader.resolve` / `TsconfigLoader.compilerOptions` — read and decode one config, resolve its full `extends` chain depth-first with per-branch cycle stacks (diamond chains are legal), a depth guard and tsc's target resolution for relative, rooted and bare-specifier targets including `exports` maps, or project the resolved chain straight down to its merged options.
- `TsconfigLoaderSync` — the synchronous facade for sync-only hosts: `load`, `resolve` and `compilerOptions` over consumer-supplied `{ fileSystem, path }` operations, running the same pipeline and throwing the same typed errors.
- `ResolvedTsconfig` — the pure merge engine behind `resolve`: per-field merge semantics, path-option absolutization against the declaring config's directory, final `${configDir}` substitution and `pathsBase` provenance, with no filesystem access at all.
- `TsconfigDiscovery.findNearest` — the nearest `tsconfig.json` (or any filename via `options.filename`) at or above a starting directory, over `@effected/walker`; one unreadable ancestor cannot hide a config above it.
- `TsEnumCodec` — the string↔numeric enum tables as plain data with zero `typescript` imports. `encodeCompilerOptions` produces the numeric shape `ts.CompilerOptions` expects, with `lib` entries in the file-name form the compiler resolves verbatim; `decodeCompilerOptions` reverses it.
- `PortableTsconfig.make` — an allow-list projection down to machine-independent type-semantics options, with `composite: false` and `noEmit: true` forced: the slice a virtual TypeScript environment (Twoslash, API Extractor, an in-memory language service) can safely inherit.
- `JsxConfig.fromCompilerOptions` — the JSX transform a bundler can configure, projected from decoded options: `react-jsx` / `react-jsxdev` select the automatic runtime with its import source (defaulting to `react`, tsc's own default), `react` selects classic, and `preserve`, `react-native` or an absent `jsx` yield `Option.none()`.
- Typed failures everywhere: a malformed file is a `TsconfigParseError` carrying its path, a broken chain is a `TsconfigExtendsError` with a `not-found` / `cycle` / `depth` / `empty` reason and the full resolution chain, and IO errors flow through as `PlatformError`. Nothing fails as a defect.

## License

[MIT](LICENSE)
