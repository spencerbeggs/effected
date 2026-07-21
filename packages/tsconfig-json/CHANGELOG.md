# @effected/tsconfig-json

## 0.2.7

### Bug Fixes

* ### Internal @effected edges float patches instead of pinning exact versions

  The kit's internal `@effected/*` dependency edges were declared as `workspace:*`, which the publish transform projects to an exact version pin. That coupled every kit release — a single sibling patch forced a coordinated re-release of every dependent, just to move the pin — and two paths pinning adjacent exact versions could not dedupe in a consumer's tree.

  Every internal `@effected/*` edge, both peer and regular dependency, is now declared `workspace:~`, which projects to a patch-floating `~0.x.y` range. A sibling patch flows into existing releases without a re-release, while a minor bump — the kit's breaking channel on the `0.x` line — still requires the intended coordinated release because `~` holds the minor. Floating the regular-dependency edges as well lets a consumer's paths dedupe onto one sibling copy, which matters where an integrated package surfaces a sibling's types across its API. The `effect` peer, the catalog specifiers, and the `devDependencies` mirrors are unchanged. [#134][#134]

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/walker | dependency | updated | 0.3.0 | 0.3.1 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#134]: https://github.com/spencerbeggs/effected/pull/134

## 0.2.6

### Dependencies

| Dependency      | Type       | Action  | From  | To    |
| --------------- | ---------- | ------- | ----- | ----- |
| @effected/jsonc | dependency | updated | 0.4.0 | 0.5.0 |

## 0.2.5

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/walker | dependency | updated | 0.2.2 | 0.3.0 |

## 0.2.4

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/jsonc  | dependency | updated | 0.3.0 | 0.4.0 |
| @effected/walker | dependency | updated | 0.2.1 | 0.2.2 |

* | Dependency | Type           | Action  | From          | To            |                                                                       |
  | ---------- | -------------- | ------- | ------------- | ------------- | --------------------------------------------------------------------- |
  | effect     | peerDependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 | [#122][#122] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#122]: https://github.com/spencerbeggs/effected/pull/122

## 0.2.3

### Dependencies

| Dependency      | Type       | Action  | From  | To    |
| --------------- | ---------- | ------- | ----- | ----- |
| @effected/jsonc | dependency | updated | 0.2.0 | 0.3.0 |

## 0.2.2

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/walker | dependency | updated | 0.2.0 | 0.2.1 |

## 0.2.1

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/jsonc  | dependency | updated | 0.1.0 | 0.2.0 |
| @effected/walker | dependency | updated | 0.1.0 | 0.2.0 |

## 0.2.0

### Features

* ### `TsconfigLoaderSync` — a synchronous facade

  For sync-only host APIs (bundler plugin hooks, config factories) that cannot run an Effect, `TsconfigLoaderSync` runs the same `TsconfigLoader` pipeline synchronously against consumer-supplied file and path operations:

  ```ts
  import { existsSync, readFileSync } from "node:fs";
  import * as path from "node:path";
  import { TsconfigLoaderSync } from "@effected/tsconfig-json";

  const resolved = TsconfigLoaderSync.resolve("./tsconfig.json", {
  	fileSystem: { exists: existsSync, readFile: (p) => readFileSync(p, "utf8") },
  	path,
  });
  ```

  `TsconfigLoaderSync.load`, `.resolve` and `.compilerOptions` mirror the async pipeline's typed failures (`TsconfigParseError`, `TsconfigExtendsError`, or a `PlatformError` wrapping a thrown read) — thrown as themselves rather than a fiber-failure wrapper. No `node:*` import and no posix assumption: pass a win32-appropriate `path` for Windows correctness.

  ### `JsxConfig` — JSX transform projection

  `JsxConfig.fromCompilerOptions` projects decoded compiler options to the JSX transform a bundler can configure: the automatic runtime (`react-jsx` / `react-jsxdev`, with `importSource` defaulting to `"react"` per tsc) or the classic runtime (`react`). `"preserve"`, `"react-native"` and an absent `jsx` project to `Option.none()` — there is nothing for a bundler to configure.

  ```ts
  import { JsxConfig } from "@effected/tsconfig-json";

  const jsx = JsxConfig.fromCompilerOptions(compilerOptions);
  // Option.some(JsxConfig({ runtime: "automatic", importSource: "react" }))
  ```

  ### `TsconfigLoader.compilerOptions`

  A thin projection of `TsconfigLoader.resolve` down to the merged `compilerOptions`, for the common "just give me the effective options" query:

  ````ts
  import { TsconfigLoader } from "@effected/tsconfig-json";
  import { Effect } from "effect";

  const program = Effect.gen(function* () {
  	const options = yield* TsconfigLoader.compilerOptions("./tsconfig.json");
  	return options;
  });
  ``` [#83](https://github.com/spencerbeggs/effected/pull/83) Thanks [@spencerbeggs](https://github.com/spencerbeggs)!
  ````

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
