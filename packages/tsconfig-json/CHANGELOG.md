# @effected/tsconfig-json

## 0.1.0

### Features

* Composable tsconfig.json handling for Effect: document and compiler-option schemas, `extends`-chain resolution with tsc's own merge semantics, nearest-config discovery, and a portable-config filter for virtual TypeScript environments. Every parse is JSONC — comments and trailing commas are legal everywhere — and options the schemas do not know pass through untouched. Zero `typescript` imports.

  ### Resolve a config and its whole extends chain

  `TsconfigLoader.resolve` folds the full `extends` chain with tsc's per-field merge semantics — later configs win, path options absolutize against the config that declared them, and `${configDir}` substitutes once at the end.

  ```ts
  import { TsconfigLoader } from "@effected/tsconfig-json";
  import { NodeFileSystem, NodePath } from "@effect/platform-node";
  import { Effect, Layer } from "effect";

  const PlatformLive = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

  const resolved = await Effect.runPromise(
    TsconfigLoader.resolve("./tsconfig.json").pipe(Effect.provide(PlatformLive)),
  );

  console.log(resolved.extendedPaths);   // every config on the chain, base-most first
  console.log(resolved.compilerOptions); // the merged options after folding the chain
  ```

  ### Discovery, enum encoding and the portable subset

  `TsconfigDiscovery.findNearest` walks up for the nearest config (absence is `Option.none()`, never an error). `TsEnumCodec` converts the string-level options to the numeric shape a real compiler expects, and `PortableTsconfig.make` narrows a resolved config to the machine-independent slice a virtual TypeScript environment can safely reuse.

  ```ts
  import { PortableTsconfig, TsEnumCodec } from "@effected/tsconfig-json";

  console.log(TsEnumCodec.encodeCompilerOptions({ target: "es2023", strict: true, lib: ["esnext"] }));
  // { target: 10, strict: true, lib: [ 'lib.esnext.d.ts' ] }

  console.log(PortableTsconfig.make(resolved).compilerOptions.noEmit);
  // true — always forced, whatever the source config declared
  ```

  Typed failures everywhere: a malformed file is a `TsconfigParseError`, a broken chain is a `TsconfigExtendsError` with a `not-found` / `cycle` / `depth` / `empty` reason, and IO errors flow through as `PlatformError`. Nothing fails as a defect. [#81][#81]

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/jsonc  | dependency | updated | 0.0.0 | 0.1.0 |
| @effected/walker | dependency | updated | 0.0.0 | 0.1.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#81]: https://github.com/spencerbeggs/effected/pull/81
