---
"@effected/tsconfig-json": minor
---

## Features

Initial release of `@effected/tsconfig-json` — composable tsconfig.json handling for Effect: string-level schemas, `extends`-chain resolution with tsc parity, and upward config discovery. Zero external runtime dependencies; `FileSystem`/`Path` arrive from `effect` core, so IO stays in the requirements channel and every failure — decode, extends resolution, or IO — surfaces through a typed error, never a defect.

```ts
import { TsconfigDiscovery, TsconfigLoader } from "@effected/tsconfig-json";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, Layer, Option } from "effect";

const program = Effect.gen(function* () {
  const nearest = yield* TsconfigDiscovery.findNearest(process.cwd());
  if (Option.isNone(nearest)) return Option.none();
  const resolved = yield* TsconfigLoader.resolve(nearest.value);
  return Option.some(resolved);
});

const PlatformLive = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

Effect.runPromise(program.pipe(Effect.provide(PlatformLive)));
```

### TsconfigLoader and TsconfigDiscovery

`TsconfigDiscovery.findNearest(start, options?)` ascends toward the filesystem root over `@effected/walker` and returns `Option.none()` on absence — never an error. `TsconfigLoader.load` reads and decodes one file; `TsconfigLoader.resolve` runs the full pipeline — decode, absolutize path options against each config's own directory, recurse into `extends` depth-first with per-branch cycle detection (diamonds are legal) and a 32-level depth guard, fold base-most-first with the leaf config winning, then substitute a leading `${configDir}` once against the top config's directory. A broken chain fails typed as `TsconfigExtendsError` with `reason: "not-found" | "cycle" | "depth" | "empty"`; a malformed file fails as `TsconfigParseError`.

### TsconfigJson and CompilerOptions

`TsconfigJson` is the document schema — every field optional, with a passthrough record so unrecognized top-level keys survive decode untouched, matching tsc's own tolerance for unknown keys. `TsconfigJsonFromString` decodes JSONC directly — there is no JSON-strict path. `CompilerOptions` keeps enum-valued options as string literal unions — case-insensitive on decode, canonical lowercase on encode — while keeping both the typed live option set and passthrough for unknown or dead options.

### ResolvedTsconfig and TsEnumCodec

`ResolvedTsconfig` is the pure merge engine behind `TsconfigLoader.resolve` — no `FileSystem`, no `Path`. `TsEnumCodec` carries the string↔numeric data tables for the nine enum families TypeScript recognizes (including the `node18`/`node20` numeric gaps) and a `lib` normalizer; `encodeCompilerOptions` emits `lib` entries in the file-name form (`lib.esnext.d.ts`) that `@effected/ts-vfs`'s `TsEnvironment` expects.

### PortableTsconfig

`PortableTsconfig.make(input)` projects a `ResolvedTsconfig` or a bare `CompilerOptions.Type` down to the small, machine-independent slice of compiler options a virtual TypeScript environment can safely reuse — an allow-list, not a deny-list, so an option this package doesn't yet classify never leaks through by accident. It forces `composite: false` and `noEmit: true` and stamps a `$schema` URL.
