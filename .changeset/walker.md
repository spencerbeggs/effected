---
"@effected/walker": minor
---

## Features

Upward path traversal as Effect primitives. Ascend the directory chain from a starting path to the filesystem root, find the nearest existing file among per-directory candidates, or find the nearest directory a marker predicate accepts. Every probe absorbs its own failure, so a single unreadable ancestor cannot hide a valid `.git` or `pnpm-workspace.yaml` above it — every public error channel is `never`. `FileSystem` and `Path` arrive from `effect` core through `R`, so no platform package is pulled in, not even in tests.

### Ascend and find

Ascend from a directory, then look for a file in each rung of the chain. `findUpward` scans directory-major, so a nearer `config/.apprc` always beats a distant ancestor's.

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

Effect.runPromise(findConfig.pipe(Effect.provide(PlatformLive))).then((found) =>
  console.log(Option.getOrNull(found)),
);
// the nearest ".apprc" at or above the cwd, or null when none is found or readable
```

### Find a root by marker

`findRoot` is the same loop over the directories themselves, with a marker predicate instead of a filename. The predicate can be expensive — the scan short-circuits at the first match and never probes the rest.

```ts
import { Walker } from "@effected/walker";
import { Effect, FileSystem, Path } from "effect";

const findGitRoot = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dirs = yield* Walker.ascend(process.cwd());
  return yield* Walker.findRoot(dirs, (dir) => fs.exists(path.join(dir, ".git")));
});
// Effect<Option<string>, never, FileSystem | Path>
```

`Walker.ascend` accepts `stopAt` to halt the ascent inclusively and `maxDepth` (default 256) to cap it; `Walker.firstMatch` exposes the underlying absorbing, short-circuiting scan directly.
