# @effected/walker

Upward directory-chain traversal: ascend toward the filesystem root and return the first candidate satisfying a predicate. The kit's one absorbing traversal loop — `config-file`, `xdg` and `workspaces` all build on it. Boundary tier: peers only on `effect`; `FileSystem`/`Path` arrive through `R` from the consumer's platform layer.

## Import

```ts
import { Walker } from "@effected/walker";
```

Single entrypoint; no subpaths.

**Platform**: `ascend` needs only `Path` (core ships a POSIX `Path.layer`); anything touching the filesystem (`findUpward`, an `fs.exists` predicate) needs `FileSystem` at the edge — `@effect/platform-node`'s `NodeFileSystem.layer` + `NodePath.layer`, or `@effect/platform-bun`.

## Core API

- **`Walker.ascend(start, options?: { stopAt?, maxDepth? })`** — each directory from `start` to the root, nearest first: `Effect<ReadonlyArray<string>, never, Path.Path>`. `start` is required; the walker never reads `process.cwd()` itself.
- **`Walker.firstMatch(candidates, predicate)`** — the single primitive: first candidate whose `Effect<boolean, E, R>` predicate is true; per-candidate failures are absorbed, defects propagate. `Effect<Option<string>, never, R>`.
- **`Walker.findUpward(dirs, candidatesFor)`** — flattens candidates directory-major, then `firstMatch(..., fs.exists)`.
- **`Walker.findRoot(dirs, isRoot)`** — marker-based root detection.

## Usage

```ts
import { Walker } from "@effected/walker";
import { Effect, FileSystem, Path } from "effect";

const findRepoRoot = Effect.gen(function* () {
 const dirs = yield* Walker.ascend(process.cwd());
 return yield* Walker.findRoot(dirs, (dir) =>
  Effect.gen(function* () {
   const fs = yield* FileSystem.FileSystem;
   return yield* fs.exists(`${dir}/.git`);
  }),
 );
});
```

## Testing machinery

None exported — none needed: test with core's `Path.layer` (POSIX, built into `effect`) and `FileSystem.layerNoop({ exists, ... })`. No platform package required in tests.

## Gotchas

- `ascend` is lexical, not physical — symlinks are not resolved; ascending out of a symlinked directory follows the path you gave it.
- A non-positive-integer `maxDepth` (0, `NaN`, `2.5`) is a defect, not a silent empty result.
- `findUpward` is directory-major: every candidate in the nearest directory is exhausted before ascending — a distant ancestor's marker can never beat a nearer directory's.
- Every public error channel is `never`: not-found and cannot-look (`EACCES`) are indistinguishable by design; discovery is best-effort.
