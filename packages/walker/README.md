# @effected/walker

[![npm](https://img.shields.io/npm/v/@effected%2Fwalker?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/walker)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

Upward path traversal as Effect primitives: ascend a directory chain and return the first candidate satisfying a predicate. Each probe absorbs its own failure, so one unreadable ancestor never hides a valid match above it.

## Install

```bash
npm install @effected/walker effect
```

```bash
pnpm add @effected/walker effect
```

Requires Node.js >=24.11.0. `effect` v4 is a peer dependency; the package itself adds no other runtime dependencies.

## Quick start

`Walker.ascend` and `Walker.findUpward` need `Path` and `FileSystem` from `effect` core, which you provide at the edge — from `@effect/platform-node` on Node:

```ts
import { Walker } from "@effected/walker";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, Layer } from "effect";

const findConfig = Effect.gen(function* () {
  const dirs = yield* Walker.ascend(process.cwd());
  return yield* Walker.findUpward(dirs, (dir) => [`${dir}/.apprc`]);
});

const PlatformLive = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

Effect.runPromise(findConfig.pipe(Effect.provide(PlatformLive))).then(console.log);
// Option.some(path) if a ".apprc" is found in cwd or an ancestor, Option.none() otherwise
```

## Features

- `Walker.ascend(start, options?)` — the directory chain from `start` toward the filesystem root, nearest first. `stopAt` halts the ascent inclusively; `maxDepth` (default 256) caps it and must be a positive integer. `start` is required — walker never reads `process.cwd()` for you.
- `Walker.firstMatch(candidates, predicate)` — the first candidate the predicate accepts. Absorbs each predicate failure individually and short-circuits at the first match.
- `Walker.findUpward(dirs, candidatesFor)` — the first existing path, directory-major: every candidate in the nearest directory is tried before ascending.
- `Walker.findRoot(dirs, isRoot)` — the nearest directory a marker predicate accepts.

Every public error channel is `never`. Because a failing probe is absorbed rather than propagated, a directory that does not exist and a directory that could not be read look identical from the outside — `Option.none()` can mean either.

## License

[MIT](LICENSE)
