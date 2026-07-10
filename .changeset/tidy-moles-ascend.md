---
"@effected/walker": minor
---

## Features

Initial release of `@effected/walker` — upward path traversal as Effect primitives. Ascend a directory chain toward the filesystem root and return the first candidate satisfying a predicate. `FileSystem` and `Path` arrive from `effect` core through the requirements channel, so the consumer's platform layer is the single place POSIX-versus-win32 semantics are chosen, and the package itself carries no runtime dependencies beyond the `effect` peer:

```ts
import { Walker } from "@effected/walker";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, Layer, Path } from "effect";

const findConfig = Effect.gen(function* () {
  const path = yield* Path.Path;
  const dirs = yield* Walker.ascend(process.cwd());
  return yield* Walker.findUpward(dirs, (dir) => [path.join(dir, ".apprc")]);
});

const PlatformLive = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

Effect.runPromise(findConfig.pipe(Effect.provide(PlatformLive))).then(console.log);
// Option.some("/home/you/project/.apprc")
```

* `Walker.ascend(start, options?)` — the directory chain from `start` toward the root, nearest first. `stopAt` halts the ascent inclusively; `maxDepth` (default `256`) caps it. `start` is required: walker never reads `process.cwd()` for you.
* `Walker.firstMatch(candidates, predicate)` — the first candidate the predicate accepts.
* `Walker.findUpward(dirs, candidatesFor)` — the first existing path, in directory-major order.
* `Walker.findRoot(dirs, isRoot)` — the nearest directory a marker predicate accepts, for anchoring on a `.git` entry or a `pnpm-workspace.yaml`.

### One absorbing loop

`firstMatch` is the whole algorithm; the other two are specializations over different candidate generators. It absorbs **each probe individually**, so an `EACCES` on one ancestor is read as "this candidate did not match" rather than aborting the scan — a permission error deep in a tree can never hide a valid root above it. Every public error channel is therefore `never`, and there is no error module.

The corollary is deliberate and worth knowing: not-found and cannot-look are indistinguishable to the caller. Discovery is best-effort, and an `Option.none()` may mean a directory was unreadable rather than empty.

Defects are not absorbed. `firstMatch` recovers from failures, not defects, so a predicate that throws surfaces as a defect rather than being silently reinterpreted as a non-match.

### Invariants

`ascend` is lexical, not physical — `Path.dirname` does not resolve symlinks, so ascending out of a symlinked directory follows the path you were given, which is what config discovery wants. It is a bounded loop, not recursion, and terminates twice over: `dirname` is a fixpoint at the root, and `maxDepth` guards a pathological `Path` implementation. A `maxDepth` that is not a positive integer is a defect rather than a silently-empty chain.

`findUpward` is directory-major: every candidate in the nearest directory is exhausted before ascending, so a `config/.apprc` beside you always beats a bare `.apprc` in a distant ancestor.
