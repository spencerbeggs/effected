# @effected/walker

[![npm](https://img.shields.io/npm/v/@effected%2Fwalker?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/walker)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

Path traversal as Effect primitives. `Walker.ascend` gives you the directory chain from a starting path to the filesystem root; `Walker.findUpward` returns the nearest existing file among per-directory candidates; `Walker.findRoot` returns the nearest directory a marker predicate accepts. Every probe absorbs its own failure, so a single unreadable ancestor cannot hide a valid `.git` or `pnpm-workspace.yaml` above it. Going the other way, `descend` expands a compiled [`@effected/glob`](https://www.npmjs.com/package/@effected/glob) pattern under a directory into the matching file paths — sorted, symlink-safe, and typed about unreadable subtrees instead of silently swallowing them. `FileSystem` and `Path` arrive from `effect` core, so no platform package is pulled in — not even in tests.

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

## Why @effected/walker

Walking up a directory tree looks like four lines of code until you meet the edges, and the edges are where the hand-rolled version quietly gets it wrong. If a probe on one ancestor fails — an `EACCES` on a directory you had no business reading anyway — the naive loop propagates that error and the whole search fails, so an unreadable directory hides the workspace root sitting one level above it. Walker absorbs each probe individually: a failed probe means "this candidate did not match", never "abort the scan". Every upward error channel is `never` as a result, and the trade is stated up front rather than discovered later — not-found and cannot-look are deliberately indistinguishable, because discovery is best-effort. The downward walk makes the opposite call on purpose: an unreadable subtree during glob expansion fails typed by default, because "no matches there" would be a wrong answer dressed as an empty one.

The other edges get the same treatment. Absorption uses `Effect.catch`, which catches failures and not defects, so a predicate that *throws* is still programmer error and still surfaces. `findUpward` scans directory-major — every candidate in the nearest directory is exhausted before ascending — so a distant ancestor's `.apprc` can never beat a nearer `config/.apprc`. `maxDepth` must be a positive integer: `NaN`, `2.5` and `0` are defects rather than a silently empty chain, which is the failure mode that looks exactly like "nothing found". And `start` is required — walker never reads `process.cwd()` on your behalf.

## Install

```bash
npm install @effected/walker effect
```

```bash
pnpm add @effected/walker effect
```

Requires Node.js >=24.11.0. `effect` v4 and `@effected/glob` are peer dependencies — walker has no runtime dependencies of its own, and the glob peer is consumed as types plus `matches()` calls only.

All `@effected/*` packages are ESM-only: the exports maps publish only `import` conditions, so `require()` — including tools that resolve in CJS mode — fails with Node's `ERR_PACKAGE_PATH_NOT_EXPORTED` rather than loading a CJS build that does not exist. Import from an ES module.

`Path` and `FileSystem` come from `effect` core, not from a platform package, so a consumer provides them once at the edge (`@effect/platform-node` on Node, `@effect/platform-bun` on Bun) and a test provides `Path.layer` and `FileSystem.layerNoop` straight from core with nothing else installed.

## Quick start

Ascend from a directory, then look for a file in each rung of the chain:

```ts
import { Walker } from "@effected/walker";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, Layer, Option, Path } from "effect";

const findConfig = Effect.gen(function* () {
  const path = yield* Path.Path;
  const dirs = yield* Walker.ascend(process.cwd());
  return yield* Walker.findUpward(dirs, (dir) => [path.join(dir, ".apprc")]);
});

const PlatformLive = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

Effect.runPromise(findConfig.pipe(Effect.provide(PlatformLive))).then((found) => console.log(Option.getOrNull(found)));
// the path of the nearest ".apprc" at or above the cwd, e.g. "/home/you/project/.apprc"
// null when no ancestor had one — or when the one that did could not be read
```

`findRoot` is the same loop over the directories themselves, with a marker predicate instead of a filename:

```ts
import { Walker } from "@effected/walker";
import { Effect, FileSystem, Path } from "effect";

const findGitRoot = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dirs = yield* Walker.ascend(process.cwd());
  return yield* Walker.findRoot(dirs, (dir) => fs.exists(path.join(dir, ".git")));
});
// Effect<Option<string>, never, FileSystem | Path> — the predicate's failures are absorbed per directory
```

The predicate can be expensive — reading and parsing a `package.json` to decide whether a directory is a workspace root, say — because the scan short-circuits at the first match and never probes the rest.

## Features

- `Walker.ascend(start, options?)` — the directory chain from `start` toward the filesystem root, nearest first. `stopAt` halts the ascent inclusively — it must be absolute, and is matched in normalized form, so a trailing separator or a `.`/`..` segment still stops where it names; a relative ceiling is a defect rather than being resolved against the working directory, exactly as an invalid `maxDepth` is. `maxDepth` (default 256) caps the chain. Lexical, not physical: `Path.dirname` does not resolve symlinks, so ascending out of a symlinked directory follows the path you were given.
- `Walker.firstMatch(candidates, predicate)` — the first candidate the predicate accepts. Absorbs each predicate failure individually and short-circuits at the first match.
- `Walker.findUpward(dirs, candidatesFor)` — the first existing path, directory-major: every candidate in the nearest directory is tried before ascending.
- `Walker.findRoot(dirs, isRoot)` — the nearest directory a marker predicate accepts. `firstMatch` where the candidate expansion is the identity.

## License

[MIT](LICENSE)
