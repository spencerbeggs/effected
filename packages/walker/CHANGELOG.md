# @effected/walker

## 0.3.0

### Features

* ### `compileAndExpand`: compile a glob pattern and expand it against the filesystem, in one call

  ```ts
  import { compileAndExpand } from "@effected/walker";
  import { GlobPatternOptions } from "@effected/glob";

  const files = yield* compileAndExpand("packages/*/src/**/*.ts", {
  	cwd: "/repo",
  	glob: GlobPatternOptions.make({ dot: true }),
  });
  ```

  New `compileAndExpand(pattern, options)` returns `Effect<ReadonlyArray<string>, GlobExpansionError, FileSystem | Path>`, matching FILE paths relative to `options.cwd`. No package previously owned the "compile a pattern and expand it against the filesystem" seam, so a downstream consumer had written four differently-shaped variants of this recipe and ended up with two divergent `dot` semantics inside one package.

  The new `GlobExpansionError` is the single typed failure for the whole recipe: its `cause` is a discriminated union of `GlobPatternError | DescendError`, with a derived `stage` getter (`"compile" | "descend"`) for callers that only need the phase. `CompileAndExpandOptions` extends `DescendOptions` with one addition — `glob`, the options the pattern compiles under — and that field is **deliberately required**, so every call site states its own matching dialect instead of one site silently defaulting and drifting from another.

### Bug Fixes

* ### `Walker.ascend` normalizes `stopAt` before comparing, so an unnormalized ceiling no longer fails open

  `stopAt` matched the ceiling by raw string equality, so a ceiling that named a real ancestor in any form other than its exact resolved spelling matched nothing and the ascent ran silently past it to the filesystem root — the unbounded walk the option exists to prevent. There was no error and no warning; from the call site the bounded walk simply looked like it worked.

  `ascend` now compares each directory's `Path.resolve` form against the resolved ceiling. A trailing separator (`/repo/`), a `.` or `..` segment (`/repo/packages/..`) and a duplicated separator all stop where they name. Normalization is idempotent, so callers already resolving at the call site — `@effected/workspaces`' `WorkspaceRoot.find` does — are unaffected.

  Two points of the contract are unchanged and now pinned by tests: `stopAt` is still **inclusive**, and normalization governs the **comparison only** — the returned chain is still the lexical one derived from `start`, unrewritten, so `ascend` through a symlinked start still follows the path it was given.

  ### A relative `stopAt` is now rejected instead of resolved against the working directory

  `Walker.ascend` requires an **absolute** `stopAt` and rejects a relative one. Pass an absolute path:

  ```ts
  // Before: silently resolved against process.cwd()
  yield* Walker.ascend(start, { stopAt: "packages" });

  // Now: resolve at the call site, where the intended base is known
  yield* Walker.ascend(start, { stopAt: path.resolve("packages") });
  ```

  A cwd-relative ceiling has no fixed meaning: the same `stopAt` bounds the walk at a different directory in a lint-staged hook, in a CLI invoked from a package directory, and under a test runner — and the caller cannot see which one they got. That is the same fail-open failure the raw string comparison above produced, reached through a different door, so `ascend` refuses it rather than guessing. Rejecting costs one `path.resolve` at the site that knows the answer; resolving silently costs a wrong walk that cannot be detected. `ascend` consequently reads `process.cwd()` nowhere.

  The rejection is a **defect** (`Effect.die`), not a typed failure, so `ascend`'s error channel stays `never` and no call site needs to change its own signature. That follows the guard for an invalid `maxDepth` directly above it: a statically-wrong caller-supplied option is bad wiring, not a recoverable condition. It also has to be a defect to work at all — a typed failure would be absorbed by `@effected/config-file`'s resolver contract, which catches every failure into `Option.none()`, and would resurface as a clean-looking "no config file found". `Effect.catch` does not catch defects, so only a defect survives that absorption; a test reconstructs the absorbing caller and pins it.

  Only the **ceiling** is constrained. A relative `start` is still fine and still ascends to the relative root. Absoluteness is judged by the injected `Path` service, so the win32 layer accepts `C:\repo`. [#125][#125]

### Dependencies

| Dependency     | Type       | Action  | From  | To    |
| -------------- | ---------- | ------- | ----- | ----- |
| @effected/glob | dependency | updated | 0.1.2 | 0.2.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#125]: https://github.com/spencerbeggs/effected/pull/125

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
