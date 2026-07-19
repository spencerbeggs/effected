# @effected/walker

## 0.2.2

### Dependencies

| Dependency     | Type       | Action  | From  | To    |
| -------------- | ---------- | ------- | ----- | ----- |
| @effected/glob | dependency | updated | 0.1.1 | 0.1.2 |

* | Dependency | Type           | Action  | From          | To            |                                                                       |
  | ---------- | -------------- | ------- | ------------- | ------------- | --------------------------------------------------------------------- |
  | effect     | peerDependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 | [#122][#122] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#122]: https://github.com/spencerbeggs/effected/pull/122

## 0.2.1

### Dependencies

| Dependency     | Type       | Action  | From  | To    |
| -------------- | ---------- | ------- | ----- | ----- |
| @effected/glob | dependency | updated | 0.1.0 | 0.1.1 |

## 0.2.0

### Features

* ### Downward glob expansion — `descend`

  `@effected/walker` gains a second traversal primitive alongside the upward `Walker`: `descend(pattern, options)` expands a compiled `@effected/glob` `GlobPattern` under `options.cwd` and returns the matching file paths (POSIX-separated, relative to `cwd`, sorted).

  ```ts
  import { descend } from "@effected/walker";
  import { GlobPattern } from "@effected/glob";
  import { Effect } from "effect";

  const program = Effect.gen(function* () {
  	const pattern = yield* GlobPattern.compile("src/**/*.ts");
  	return yield* descend(pattern, { cwd: "/repo" });
  });
  ```

  `DescendOptions` accepts `maxDepth` (default `256`), `prune` (directory names never descended into; defaults to `["node_modules", ".git"]`), and `onUnreadable` (`"fail"` by default, or `"skip"` to absorb an unreadable directory instead of failing).

  The walker is semantics-free — dotfile handling, case folding and every other matching option live on the compiled pattern, not on `descend` itself. Only files match; a symlinked directory is never descended into. An unreadable directory mid-walk or a walk past `maxDepth` fails typed as the new `DescendError`, distinct from the upward walker's per-candidate absorption: a swallowed subtree in a downward enumeration would silently understate membership, so the default is to fail rather than degrade.

  This adds a new peer dependency on `@effected/glob` (type-only: `descend` imports `GlobPattern` as a type and calls its `matches()` method). [#91][#91]

### Dependencies

* | Dependency     | Type           | Action | From | To    |                                                                     |
  | -------------- | -------------- | ------ | ---- | ----- | ------------------------------------------------------------------- |
  | @effected/glob | peerDependency | added  | —    | 0.1.0 | [#91][#91] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#91]: https://github.com/spencerbeggs/effected/pull/91

## 0.1.0

### Features

* Upward path traversal as Effect primitives. Ascend the directory chain from a starting path to the filesystem root, find the nearest existing file among per-directory candidates, or find the nearest directory a marker predicate accepts. Every probe absorbs its own failure, so a single unreadable ancestor cannot hide a valid `.git` or `pnpm-workspace.yaml` above it — every public error channel is `never`. `FileSystem` and `Path` arrive from `effect` core through `R`, so no platform package is pulled in, not even in tests.

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

  `Walker.ascend` accepts `stopAt` to halt the ascent inclusively and `maxDepth` (default 256) to cap it; `Walker.firstMatch` exposes the underlying absorbing, short-circuiting scan directly. [#81][#81]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#81]: https://github.com/spencerbeggs/effected/pull/81
